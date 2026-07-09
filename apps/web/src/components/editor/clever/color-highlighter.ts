import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { findColors } from "./find-colors";

/**
 * Recognizes hex colors (e.g. `#A975FF`) anywhere in the text and renders a
 * small color swatch beside them — the "clever editor" trick of teaching the
 * editor to understand its own content. Pure decoration, recomputed on every
 * doc change; nothing is written to the document.
 */
export const ColorHighlighter = Extension.create({
  name: "colorHighlighter",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("colorHighlighter"),
        state: {
          init(_, { doc }) {
            return findColors(doc);
          },
          apply(transaction, oldState) {
            return transaction.docChanged ? findColors(transaction.doc) : oldState;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
