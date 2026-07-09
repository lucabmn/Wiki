import type { Node } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const HEX_COLOR = /(#[0-9a-f]{3,6})\b/gi;

/**
 * Scans a document for hex color codes and returns inline decorations that tag
 * each one with a `color` class and a `--color` CSS variable, so the stylesheet
 * can render a swatch next to it. Decorations are view-only — they never touch
 * the stored document, so they add nothing to the (collaborative) schema.
 */
export function findColors(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.text) return;

    for (const match of node.text.matchAll(HEX_COLOR)) {
      const color = match[0];
      if (!color) continue;
      const from = position + (match.index ?? 0);
      const to = from + color.length;
      decorations.push(
        Decoration.inline(from, to, {
          class: "color",
          style: `--color: ${color}`,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}
