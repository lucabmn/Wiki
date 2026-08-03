// Vercel serverless entry point for the collaboration WebSocket. Vercel builds
// every file under `api/` into a function; vercel.json rewrites everything here,
// so this one function accepts every socket.
//
// It re-exports a web-standard `GET` handler (not the legacy
// `(req, res)` default export the API server uses): `experimental_upgradeWebSocket`
// returns a `Response`, and Hocuspocus v4's `handleConnection` wants a
// web-standard `Request` — both of which only exist in this signature.
//
// It imports the *bundled* output rather than `../src/vercel.ts` on purpose: the
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
// type-checked by `tsdown`/`tsc --noEmit`.
export { GET } from "../dist/vercel.mjs";
