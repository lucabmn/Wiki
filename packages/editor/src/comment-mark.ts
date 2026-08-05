import { Mark, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * The inline-comment mark. It carries no comment *content* — only the id that
 * `comment.anchor` points back at (see `comment-anchor.ts` for why the anchor
 * is a mark at all).
 *
 * This lives in the shared schema package on purpose: `apps/collab` builds its
 * ProseMirror schema from the exact same extension list, and a mark the collab
 * server doesn't know is silently dropped when it projects the Yjs document
 * back into `page.content` — every highlight on the page would vanish on the
 * next save.
 */
export const COMMENT_MARK_NAME = "comment";
export const COMMENT_MARK_ATTRIBUTE = "data-comment-id";
/** Applied to every rendered mark; the browser adds the "live"/"active" state. */
export const COMMENT_MARK_CLASS = "comment-mark";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      /** Annotate the current selection with `id`. */
      setCommentMark: (id: string) => ReturnType;
      /** Remove every occurrence of `id`, leaving overlapping comments intact. */
      unsetCommentMark: (id: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: COMMENT_MARK_NAME,

  /**
   * Two comments on overlapping ranges are normal, not the exception. The
   * default (`excludes` = the mark's own name) would make ProseMirror replace
   * the existing mark instead of nesting a second one.
   */
  excludes: "",

  /**
   * A comment annotates exactly the text it was made on: typing at either edge
   * must not silently grow the annotated range.
   */
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute(COMMENT_MARK_ATTRIBUTE),
        renderHTML: (attributes) =>
          attributes.id ? { [COMMENT_MARK_ATTRIBUTE]: attributes.id as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${COMMENT_MARK_ATTRIBUTE}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: COMMENT_MARK_CLASS }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCommentMark:
        (id: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { id }),

      unsetCommentMark:
        (id: string) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks[this.name];
          if (!type) return false;
          let removed = false;
          // Range-wise rather than `unsetMark`: only this comment's mark goes,
          // any other comment covering the same words stays. Removing a mark
          // never changes the document size, so the positions collected while
          // walking stay valid for the whole transaction.
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.id === id) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                removed = true;
              }
            }
          });
          if (removed && dispatch) dispatch(tr);
          return removed;
        },
    };
  },
});

/** Every comment id currently anchored in `doc`. */
export function commentMarkIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === COMMENT_MARK_NAME && typeof mark.attrs.id === "string") {
        ids.add(mark.attrs.id);
      }
    }
  });
  return ids;
}

/**
 * The text `id` currently annotates, or `""` when the mark is gone. Used to
 * tell an anchor that still resolves from one that has been orphaned.
 */
export function commentMarkText(doc: ProseMirrorNode, id: string): string {
  let text = "";
  doc.descendants((node) => {
    if (!node.isText) return;
    const anchored = node.marks.some(
      (mark) => mark.type.name === COMMENT_MARK_NAME && mark.attrs.id === id,
    );
    if (anchored) text += node.text ?? "";
  });
  return text;
}
