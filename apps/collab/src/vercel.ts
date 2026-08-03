import { Hocuspocus } from "@hocuspocus/server";
import { experimental_upgradeWebSocket, waitUntil } from "@vercel/functions";
import { initLogger, log, parseError } from "evlog";
import type { RawData, WebSocket } from "ws";

import { env } from "@nilovon-wiki/env/collab";

import { createCollabConfiguration, settleStores } from "./hocuspocus";

/**
 * Serverless entry: serves the collab WebSocket from a Vercel Function.
 *
 * This exists alongside `src/index.ts` (the long-lived Node process used by
 * Docker) and shares all persistence/authorization rules with it via
 * `createCollabConfiguration`. What differs is everything the platform forces:
 *
 * 1. No `listen()`. Vercel hands us an already-accepted socket, so we drive
 *    `Hocuspocus` directly through `handleConnection` and pump the `ws` events
 *    into the returned `ClientConnection`.
 * 2. `REDIS_URL` is mandatory. Hocuspocus keeps each document in memory, and
 *    Vercel gives no affinity — two editors of the same page routinely land on
 *    different function instances. Redis pub/sub is the only thing that makes
 *    them one document. Without it the deployment looks healthy and silently
 *    splits users into isolated copies, so we refuse to start instead.
 * 3. Aggressive persistence. A function instance is frozen without SIGTERM, so
 *    a pending debounced store would be lost; see `STORE_DEBOUNCE_MS`.
 *
 * Residual limitation, by platform design: a connection lives at most as long
 * as the function's `maxDuration`, after which the socket closes and the
 * browser's `HocuspocusProvider` reconnects (re-fetching a fresh collab token,
 * because `page-editor.tsx` passes `token` as an async function).
 */

initLogger({ env: { service: "nilovon-wiki-collab" } });

/**
 * Write through to Postgres quickly. Hocuspocus defaults to 2s/10s, which
 * assumes a process that gets a shutdown signal and can flush. Vercel freezes
 * instances instead, so anything still sitting in the debouncer when the
 * connection ends is gone. We keep a debounce (writing on every keystroke would
 * hammer the DB) but a short one, and flush explicitly on close below.
 */
const STORE_DEBOUNCE_MS = 400;
const STORE_MAX_DEBOUNCE_MS = 2_000;

if (!env.REDIS_URL) {
  throw new Error(
    "REDIS_URL is required for the serverless collab deployment: without Redis pub/sub, editors served by different function instances cannot see each other's changes.",
  );
}

// Module scope, so a warm instance reuses one Hocuspocus (and one pair of Redis
// connections) across every socket it serves rather than per invocation.
const hocuspocus = new Hocuspocus(
  createCollabConfiguration({
    authSecret: env.BETTER_AUTH_SECRET,
    redisUrl: env.REDIS_URL,
    debounce: STORE_DEBOUNCE_MS,
    maxDebounce: STORE_MAX_DEBOUNCE_MS,
  }),
);

/** `ws` hands us a Buffer, an ArrayBuffer or a list of Buffers, per frame. */
function toUint8Array(data: RawData, isBinary: boolean): Uint8Array | null {
  // The Yjs sync protocol is entirely binary; a text frame is not ours.
  if (!isBinary) return null;
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  // A Buffer is a view into a pooled ArrayBuffer, so the offset/length matter.
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function attach(ws: WebSocket, request: Request): void {
  const connection = hocuspocus.handleConnection(ws, request);

  ws.on("message", (data: RawData, isBinary: boolean) => {
    const message = toUint8Array(data, isBinary);
    if (message) connection.handleMessage(message);
  });

  ws.on("error", (error) => {
    log.error({ source: "collab", op: "socket", ...parseError(error) });
  });

  ws.on("close", (code: number, reason: Buffer) => {
    connection.handleClose({ code, reason: reason.toString() } as CloseEvent);
    // The instance may be frozen the moment this invocation returns, so do not
    // leave the last edits sitting in the debouncer. `flushPendingStores` only
    // *starts* the writes (it returns `void`), so hand the resulting queries to
    // `waitUntil` — otherwise the freeze can land mid-UPDATE and lose them.
    hocuspocus.flushPendingStores();
    waitUntil(settleStores());
  });
}

export async function GET(request: Request): Promise<Response> {
  return experimental_upgradeWebSocket((ws) => attach(ws, request));
}
