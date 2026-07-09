/**
 * The page TipTap schema now lives in `@nilovon-wiki/editor` so the headless
 * collaboration server (`apps/collab`) and the browser build the exact same
 * ProseMirror schema — a prerequisite for Yjs CRDT sync. Re-exported here to
 * keep the editor's local imports stable.
 */
export { pageEditorExtensions } from "@nilovon-wiki/editor";
