import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { generateText } from "@tiptap/core";
import { eq } from "drizzle-orm";
import { initLogger, log, parseError } from "evlog";
import * as Y from "yjs";

import { pageIdFromDocName, verifyCollabToken } from "@nilovon-wiki/api/lib/collab-token";
import { extractPageLinks, syncPageLinks } from "@nilovon-wiki/api/lib/page-links";
import { db } from "@nilovon-wiki/db";
import { page } from "@nilovon-wiki/db/schema/index";
import { pageEditorExtensions } from "@nilovon-wiki/editor";
import { env } from "@nilovon-wiki/env/collab";

/**
 * Real-time collaboration server for page bodies.
 *
 * Runs as a standalone Node process (Hocuspocus is built on `ws`/crossws and
 * refuses to run under Bun), separate from the Bun/Hono API. One Yjs document
 * per page (`page:<id>`); the Yjs CRDT is the source of truth while a page is
 * open. On every (debounced) save the server projects the shared doc back into
 * the page's `content` + `textContent` so search, the read-only renderer, and
 * `pages.publish` (which snapshots `content`) keep working unchanged.
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

  // First time this page is opened collaboratively: hydrate the Yjs doc from the
  // last content persisted by the (pre-collab) editor so nothing is lost.
  if (row.content) {
    const ydoc = TiptapTransformer.toYdoc(row.content, FIELD, pageEditorExtensions());
    return Y.encodeStateAsUpdate(ydoc);
  }
  return null;
}

/** Persist the Yjs snapshot and project it back into content/textContent. */
async function storeDocument(pageId: string, state: Uint8Array, document: Y.Doc): Promise<void> {
  const json = TiptapTransformer.fromYdoc(document, FIELD);
  const textContent = generateText(json, pageEditorExtensions());
  const targets = extractPageLinks(json);

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(page)
      .set({ yjsState: state, content: json, textContent })
      .where(eq(page.id, pageId))
      .returning({ spaceId: page.spaceId });
    const row = rows[0];
    if (!row) return; // page was deleted while open — nothing to reconcile
    await syncPageLinks(tx, pageId, row.spaceId, targets);
  });
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
    return { user: { id: claims.u, name: claims.n } };
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
          await storeDocument(pageId, state, document);
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
