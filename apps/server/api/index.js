// Vercel serverless entry point. Vercel builds every file under `api/` into a
// function; vercel.json rewrites everything here, so this one function serves
// the whole Hono app.
//
// It imports the *bundled* output rather than `../src/index.ts` on purpose: the
// workspace packages export raw TypeScript (`@nilovon-wiki/api` -> `./src/*.ts`),
// which Vercel's Node builder does not resolve through pnpm symlinks. `tsdown`
// already inlines them (`noExternal: [/@nilovon-wiki\/.*/]`), so the bundle has
// only real npm dependencies left as bare imports.
//
// Plain `.js`, not `.ts`: `@vercel/node` compiles a TypeScript entrypoint with
// whatever `typescript` the workspace resolves, and this repo is on TS 7, whose
// native compiler exposes no `ts.sys` — the builder dies with
// "Cannot read properties of undefined (reading 'readFile')". A JavaScript
// entrypoint skips that path entirely. The file it imports is already built and
// type-checked by `tsdown`/`tsc -b`.
//
// Exported as a bare `fetch`, not a default `(req, res)` function. `@vercel/node`
// picks the handler style by *shape*: it unwraps `default` and then looks for a
// `fetch` method or uppercase HTTP-method exports. Anything else is treated as a
// legacy Node handler and gets `IncomingMessage`/`ServerResponse` — which is why
// `hono/vercel`'s plain `(req) => app.fetch(req)` fails with
// "this.raw.headers.get is not a function".
//
// `@hono/node-server/vercel` bridges that signature, but on Vercel it deadlocks
// every request with a body: the legacy path first runs `addHelpers`, which
// drains the request stream to populate `req.body` and then replays it by
// monkey-patching only `req.on('data'|'end')` and `req.read`. The adapter builds
// its `Request` with `Readable.toWeb(incoming)`, which drives the stream through
// internals that patch never touches — so `c.req.json()` awaits a body that
// never arrives. No error, no log, just a hang until FUNCTION_INVOCATION_TIMEOUT.
// GETs were unaffected, so only POSTs that read a body (i.e. every sign-in) hung.
//
// Exporting `fetch` selects the web-standard path instead: helpers never run, the
// runtime hands us a real `Request`, and the body is intact. Same shape the
// collab function uses (`export { GET }`).
//
// `app.fetch` is a bound class field on Hono, so detaching it here is safe.
import app from "../dist/index.mjs";

export const fetch = app.fetch;
