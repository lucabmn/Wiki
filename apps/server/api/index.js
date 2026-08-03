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
// The adapter is `@hono/node-server/vercel`, not `hono/vercel`: the latter just
// calls `app.fetch(req)` and assumes a web-standard `Request`, but a default-
// exported Vercel function receives Node's `IncomingMessage`/`ServerResponse`
// ("this.raw.headers.get is not a function"). This adapter bridges them.
import { handle } from "@hono/node-server/vercel";
import app from "../dist/index.mjs";

export default handle(app);
