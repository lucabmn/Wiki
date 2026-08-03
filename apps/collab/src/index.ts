import { Server } from "@hocuspocus/server";
import { initLogger, log, parseError } from "evlog";

import { env } from "@nilovon-wiki/env/collab";

import { createCollabConfiguration } from "./hocuspocus";

/**
 * Real-time collaboration server for page bodies — long-lived process entry.
 *
 * Runs as a standalone Node process (Hocuspocus is built on `ws`/crossws and
 * refuses to run under Bun), separate from the Bun/Hono API. One Yjs document
 * per page (`page:<id>`); the Yjs CRDT is the source of truth for the *working
 * copy* while a page is open.
 *
 * This is the entry used by `apps/collab/Dockerfile` and docker-compose. The
 * serverless variant lives in `src/vercel.ts`; both share the persistence and
 * authorization rules from `src/hocuspocus.ts`.
 *
 * Publish model: the shared doc is the private working draft. The server
 * persists it as `yjsState` ONLY — it does NOT project into `content` /
 * `textContent`. Those columns are the *published* projection and are written
 * exclusively by `pages.publish`, so in-progress edits stay invisible to
 * readers, search, and backlinks until an editor explicitly publishes. On first
 * connect the doc is seeded from the last published `content`.
 *
 * Authorization is delegated to the API server: a client presents a short-lived,
 * page-scoped token minted by `pages.collabToken` only after a full `page:write`
 * check. Here we merely verify its HMAC signature and scope. See
 * `@nilovon-wiki/api/lib/collab-token`.
 */

initLogger({ env: { service: "nilovon-wiki-collab" } });

const server = new Server({
  port: env.COLLAB_PORT,
  ...createCollabConfiguration({
    authSecret: env.BETTER_AUTH_SECRET,
    redisUrl: env.REDIS_URL,
  }),
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
 *
 * Deliberately absent from `src/vercel.ts`: there the platform's function
 * duration cap tears every socket down far more often than the token TTL.
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
