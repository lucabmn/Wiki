import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { eq } from "drizzle-orm";
import { initLogger, log, parseError } from "evlog";
import * as Y from "yjs";

import { pageIdFromDocName, verifyCollabToken } from "@nilovon-wiki/api/lib/collab-token";
import { db } from "@nilovon-wiki/db";
import { page } from "@nilovon-wiki/db/schema/index";
import { pageEditorExtensions } from "@nilovon-wiki/editor";
import { env } from "@nilovon-wiki/env/collab";

/**
 * Real-time collaboration server for page bodies.
 *
 * Runs as a standalone Node process (Hocuspocus is built on `ws`/crossws and
 * refuses to run under Bun), separate from the Bun/Hono API. One Yjs document
 * per page (`page:<id>`); the Yjs CRDT is the source of truth for the *working
 * copy* while a page is open.
 *
 * Publish model: the shared doc is the private working draft. The server
 * persists it as `yjsState` ONLY — it does NOT project into `content` /
 * `textContent`. Those columns are the *published* projection and are written
 * exclusively by `pages.publish`, so in-progress edits stay invisible to
 * readers, search, and backlinks until an editor explicitly publishes. On first
 * connect the doc is seeded from the last published `content` (see
 * `fetchDocument`).
 *
 * Authorization is delegated to the API server: a client presents a short-lived,
 * page-scoped token minted by `pages.collabToken` only after a full `page:write`
 * check. Here we merely verify its HMAC signature and scope. See
 * `@nilovon-wiki/api/lib/collab-token`.
 */

initLogger({ env: { service: "nilovon-wiki-collab" } });

// The Yjs fragment field the TipTap Collaboration extension writes to; must
// match the browser's `Collaboration.configure({ field })` default.
const FIELD = "default";

/** Load the page's Yjs snapshot (or seed one from its stored JSON content). */
async function fetchDocument(pageId: string): Promise<Uint8Array | null> {
  const row = await db.query.page.findFirst({
    where: eq(page.id, pageId),
    columns: { yjsState: true, content: true },
  });
  if (!row) return null;
  if (row.yjsState && row.yjsState.byteLength > 0) return row.yjsState;

  // First time this page is opened collaboratively: seed the working-copy Yjs
  // doc from the last published `content` so editing resumes from what readers
  // currently see (empty for a page that has never been published).
  if (row.content) {
    const ydoc = TiptapTransformer.toYdoc(row.content, FIELD, pageEditorExtensions());
    return Y.encodeStateAsUpdate(ydoc);
  }
  return null;
}

/**
 * Persist the working-copy CRDT snapshot ONLY. The published projection
 * (`content` / `textContent` + backlinks) is written solely by `pages.publish`,
 * so debounced edits never leak into any reader-facing surface.
 */
async function storeDocument(pageId: string, state: Uint8Array): Promise<void> {
  // A no-op WHERE (page deleted while open) simply updates nothing.
  await db.update(page).set({ yjsState: state }).where(eq(page.id, pageId));
}

const server = new Server({
  port: env.COLLAB_PORT,
  name: "nilovon-wiki-collab",

  async onAuthenticate({ token, documentName }) {
    const pageId = pageIdFromDocName(documentName);
    if (!pageId) throw new Error("invalid document");

    const claims = await verifyCollabToken(env.BETTER_AUTH_SECRET, token);
    // Reject a missing/expired/tampered token, or a valid token scoped to a
    // different page than the socket is trying to open.
    if (!claims || claims.p !== pageId) throw new Error("unauthorized");

    // Exposed to awareness (collaboration cursors) and to hooks as `context`.
    // `exp` drives the periodic re-auth sweep below.
    return { user: { id: claims.u, name: claims.n }, exp: claims.exp };
  },

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const pageId = pageIdFromDocName(documentName);
        if (!pageId) return null;
        return fetchDocument(pageId);
      },
      store: async ({ documentName, state, document }) => {
        const pageId = pageIdFromDocName(documentName);
        if (!pageId) return;
        try {
          await storeDocument(pageId, state);
        } catch (error) {
          log.error({ source: "collab", op: "store", documentName, ...parseError(error) });
          // Persisting failed: without this, users keep typing into a document
          // that will never be saved. Closing the connections surfaces the
          // problem in the client UI ("connection lost") and triggers its
          // reconnect loop instead of silent data loss.
          for (const connection of document.getConnections()) {
            connection.close();
          }
        }
      },
    }),
  ],
});

/**
 * Periodic re-authorization sweep.
 *
 * `onAuthenticate` only runs at connect time, so an already-open socket would
 * otherwise outlive a revoked page grant indefinitely. Each connection carries
 * its token's `exp`; once that passes we close the socket. The browser provider
 * reconnects and re-fetches a fresh token from the API (`pages.collabToken`),
 * which re-runs the full `page:write` check — so a user whose access was revoked
 * can no longer obtain a token and is evicted. This makes the revocation bound
 * documented on `COLLAB_TOKEN_TTL_SECONDS` real for long-lived connections,
 * without duplicating any authorization logic here.
 */
const REVALIDATE_INTERVAL_MS = 60_000;
const revalidator = setInterval(() => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const document of server.hocuspocus.documents.values()) {
    for (const connection of document.getConnections()) {
      const exp = (connection.context as { exp?: number } | undefined)?.exp;
      if (typeof exp === "number" && exp <= nowSeconds) {
        connection.close();
      }
    }
  }
}, REVALIDATE_INTERVAL_MS);
revalidator.unref?.();

server
  .listen()
  .then(() => log.info({ source: "collab", msg: "listening", port: env.COLLAB_PORT }))
  .catch((error) => {
    log.error({ source: "collab", msg: "failed to start", ...parseError(error) });
    process.exit(1);
  });

// Flush open documents before exiting: `destroy()` runs the debounced store
// for every open doc, so a rolling restart doesn't drop in-flight edits.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(revalidator);
  log.info({ source: "collab", msg: "shutting down", signal });
  try {
    await server.destroy();
  } catch (error) {
    log.error({ source: "collab", msg: "shutdown error", ...parseError(error) });
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
