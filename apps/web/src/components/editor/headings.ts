// Pulls the heading outline out of a stored page document for the table of
// contents. Ids are positional (`heading-<n>` in document order) so they match
// the ids PageContent injects into the rendered HTML without threading state.

export type Heading = { id: string; level: number; text: string };

type Node = {
  type?: string;
  attrs?: { level?: number };
  text?: string;
  content?: Node[];
};

/** Concatenates the plain text of a node's inline children. */
function textOf(node: Node): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(textOf).join("");
}

export function extractHeadings(content: unknown): Heading[] {
  const headings: Heading[] = [];
  const visit = (node: Node | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "heading") {
      headings.push({
        id: `heading-${headings.length}`,
        level: node.attrs?.level ?? 1,
        text: textOf(node).trim(),
      });
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(content as Node);
  // Ids stay positional over ALL headings so they line up with the ids injected
  // into the rendered HTML; the TOC skips empty ones at render time.
  return headings;
}
