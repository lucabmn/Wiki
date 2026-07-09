import type { Extensions } from "@tiptap/core";
import Typography from "@tiptap/extension-typography";

import { ColorHighlighter } from "./color-highlighter";
import { SmilieReplacer } from "./smilie-replacer";

/**
 * The "clever editor" bundle (Tiptap advanced example): the editor understands
 * and rewrites content as you type.
 *
 * - `Typography` — smart quotes, dashes, arrows, fractions, ©/™, ≠, × …
 * - `SmilieReplacer` — ASCII smilies → emoji
 * - `ColorHighlighter` — a swatch next to any hex color
 *
 * All three are schema-neutral (input rules + view decorations only), so they
 * live on the browser editor and never enter the shared collaborative schema —
 * their text output syncs like any other edit.
 */
export function cleverEditorExtensions(): Extensions {
  return [Typography, SmilieReplacer, ColorHighlighter];
}
