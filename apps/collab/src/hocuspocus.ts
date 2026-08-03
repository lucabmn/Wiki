import { Database } from "@hocuspocus/extension-database";
import { Redis } from "@hocuspocus/extension-redis";
import type { Configuration, Extension } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { eq } from "drizzle-orm";
import { log, parseError } from "evlog";
import IORedis from "ioredis";
import * as Y from "yjs";

import { pageIdFromDocName } from "@nilovon-wiki/api/lib/collab-token";
import { db } from "@nilovon-wiki/db";
import { page } from "@nilovon-wiki/db/schema/index";
import { pageEditorExtensions } from "@nilovon-wiki/editor";

import { authorizeCollab } from "./authorize";

/**
 * The Hocuspocus behaviour shared by both deployment targets: the long-lived
 * Node process (`src/index.ts`, used by Docker) and the serverless WebSocket
 * function (`src/vercel.ts`). Keeping it here means the persistence rules and
 * the authorization hook cannot drift between the two.
 */

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

export type CollabConfigurationOptions = {
  /** Shared secret used to verify page-scoped collab tokens minted by the API. */
  authSecret: string;
  /**
   * When set, updates and awareness are mirrored between server instances over
   * Redis pub/sub. Required as soon as more than one instance can serve the
   * same document.
   */
  redisUrl?: string;
  /**
   * How long to sit on a changed document before writing it to Postgres. The
   * default matches Hocuspocus (2s / 10s); the serverless entry lowers it
   * because its process can be frozen without warning.
   */
  debounce?: number;
  maxDebounce?: number;
};

export function createCollabConfiguration({
  authSecret,
  redisUrl,
  debounce,
  maxDebounce,
}: CollabConfigurationOptions): Partial<Configuration> {
  const extensions: Extension[] = [
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
  ];

  if (redisUrl) {
    extensions.push(
      new Redis({
        // `createClient` is called twice — the extension needs a dedicated
        // subscriber connection because a subscribed ioredis client cannot
        // issue normal commands. Building them from the URL (rather than
        // host/port) keeps `rediss://` TLS and inline credentials working.
        createClient: () => new IORedis(redisUrl, { maxRetriesPerRequest: null }),
      }),
    );
  }

  return {
    name: "nilovon-wiki-collab",
    ...(debounce === undefined ? {} : { debounce }),
    ...(maxDebounce === undefined ? {} : { maxDebounce }),

    // The returned identity is exposed to awareness (collaboration cursors) and
    // to hooks as `context`; its `exp` drives the periodic re-auth sweep in the
    // long-lived entry point.
    onAuthenticate: ({ token, documentName }) => authorizeCollab(authSecret, token, documentName),

    extensions,
  };
}
