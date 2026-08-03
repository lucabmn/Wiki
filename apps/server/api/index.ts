// Vercel serverless entry point. Vercel builds every file under `api/` into a
// function; everything is rewritten here by vercel.json, so this one function
// serves the whole Hono app.
//
// It imports the *bundled* output rather than `../src/index.ts` on purpose: the
// workspace packages export raw TypeScript (`@nilovon-wiki/api` -> `./src/*.ts`),
// which Vercel's Node builder does not resolve through pnpm symlinks. `tsdown`
// already inlines them (`noExternal: [/@nilovon-wiki\/.*/]`), so the bundle has
// only real npm dependencies left as bare imports.
//
// Excluded from `tsc` (see tsconfig.json) because `dist/` ships no declarations
// and does not exist on a fresh checkout.
import { handle } from "hono/vercel";
import app from "../dist/index.mjs";

export default handle(app);
