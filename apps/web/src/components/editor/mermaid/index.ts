/**
 * Browser half of the diagram feature. The node SPEC is in
 * `@nilovon-wiki/editor` (shared with the collab server); everything here needs
 * a DOM and lazy-loads Mermaid on first use.
 */
export { MermaidDiagramView } from "./diagram";
export { createMermaidNodeView, MERMAID_TEMPLATE } from "./node-view";
export { useMermaidReadView } from "./read-view";
export { sanitizeSvg } from "./sanitize";
