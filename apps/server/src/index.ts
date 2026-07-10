import { createContext } from "@nilovon-wiki/api/context";
import { appRouter } from "@nilovon-wiki/api/routers/index";
import { auth } from "@nilovon-wiki/auth";
import { closeDb, pingDb } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { initLogger, log, parseError } from "evlog";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { rateLimit } from "./rate-limit";

initLogger({
  env: { service: "nilovon-wiki-server" },
});

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(evlog());
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    // The generated REST surface (`/v1`) uses PATCH/PUT/DELETE;
    // omitting them here made every browser call to those routes fail preflight.
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // `x-orpc-batch` is sent by the client's BatchLinkPlugin; without it the
    // CORS preflight rejects every batched /rpc call.
    allowHeaders: ["Content-Type", "Authorization", "x-orpc-batch"],
    credentials: true,
  }),
);

// Page documents are the largest legitimate payloads; 10 MB leaves generous
// headroom while bounding what an unauthenticated client can make us buffer.
app.use("/*", bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// Max RPC calls the client's BatchLinkPlugin bundles into one HTTP request;
// pinned so the batch handler and the rate limiter agree on the ceiling.
const RPC_BATCH_MAX = 10;

app.use("/api/auth/*", rateLimit({ max: env.RATE_LIMIT_AUTH_MAX, keyPrefix: "auth" }));
app.use(
  "/rpc/*",
  rateLimit({
    max: env.RATE_LIMIT_MAX,
    keyPrefix: "api",
    // A batched request (`x-orpc-batch`) bundles up to RPC_BATCH_MAX calls in
    // one HTTP request; charge it for the whole batch so 10 calls cost 10, not 1.
    weight: (c) => (c.req.header("x-orpc-batch") ? RPC_BATCH_MAX : 1),
  }),
);
app.use("/v1/*", rateLimit({ max: env.RATE_LIMIT_MAX, keyPrefix: "api" }));

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      log.error({ source: "orpc", handler: "openapi", ...parseError(error) });
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  // Decodes batched calls from the client's BatchLinkPlugin. Must be present
  // or batched requests 404. `maxSize` is pinned to the same ceiling the rate
  // limiter charges per batch (see RPC_BATCH_MAX).
  plugins: [new BatchHandlerPlugin({ maxSize: RPC_BATCH_MAX })],
  interceptors: [
    onError((error) => {
      log.error({ source: "orpc", handler: "rpc", ...parseError(error) });
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/v1",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

// Deep health check: verifies the database is reachable, not just that the
// process accepts TCP. Orchestrators and the compose healthcheck use this so
// a server with a dead database is reported unhealthy instead of "OK".
app.get("/health", async (c) => {
  try {
    await pingDb();
    return c.json({ status: "ok" });
  } catch (error) {
    log.error({ source: "health", ...parseError(error) });
    return c.json({ status: "unhealthy" }, 503);
  }
});

// Drain database connections on orchestrator-initiated restarts so in-flight
// transactions finish cleanly instead of dying with the socket.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ source: "server", msg: "shutting down", signal });
  try {
    await closeDb();
  } catch (error) {
    log.error({ source: "server", msg: "shutdown error", ...parseError(error) });
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export default app;
