import { COMMENT_MARK_ATTRIBUTE } from "@nilovon-wiki/editor/comment-mark";
import { useEffect, useState, type RefObject } from "react";

/** State classes the rail paints onto the rendered marks. */
export const MARK_LIVE_CLASS = "comment-mark--live";
export const MARK_ACTIVE_CLASS = "comment-mark--active";
export const MARK_RESOLVED_CLASS = "comment-mark--resolved";

const SELECTOR = `[${COMMENT_MARK_ATTRIBUTE}]`;

/** Every rendered segment of every comment mark inside `root`. */
export function commentMarkElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)];
}

export function markIdOf(element: Element): string | null {
  return element.getAttribute(COMMENT_MARK_ATTRIBUTE);
}

/**
 * First rendered segment of `markId`. Matched by walking the marks rather than
 * with an attribute selector — ids come from the document and would have to be
 * escaped into a valid selector first.
 */
export function findCommentMark(root: HTMLElement, markId: string): HTMLElement | null {
  return commentMarkElements(root).find((element) => markIdOf(element) === markId) ?? null;
}

function measure(root: HTMLElement): Map<string, number> {
  const rootTop = root.getBoundingClientRect().top;
  const tops = new Map<string, number>();
  for (const element of commentMarkElements(root)) {
    const id = markIdOf(element);
    if (!id) continue;
    // A mark can be split across several text nodes (a link inside it, a line
    // break): the topmost segment is where the thread belongs.
    const top = Math.max(0, Math.round(element.getBoundingClientRect().top - rootTop));
    const previous = tops.get(id);
    if (previous === undefined || top < previous) tops.set(id, top);
  }
  return tops;
}

function same(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, top] of a) if (b.get(id) !== top) return false;
  return true;
}

/**
 * Where each inline-comment highlight sits inside `container`, keyed by mark id.
 *
 * Deliberately reads the DOM rather than the editor state: the comment mark
 * serializes to the same `<span data-comment-id>` in both the editable
 * ProseMirror surface and the read-only HTML, so one measurement path serves
 * both views — and readers, who have no editor at all, are the majority.
 *
 * Re-measures whenever the container's markup changes (typing, a remote edit, a
 * new revision) and whenever layout can have moved (resize, font load).
 * `revision` forces a pass after React swaps the rendered HTML.
 */
export function useCommentMarks(
  container: RefObject<HTMLElement | null>,
  revision: unknown,
): Map<string, number> {
  const [tops, setTops] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      setTops((current) => {
        const next = measure(root);
        return same(current, next) ? current : next;
      });
    };
    // Coalesce bursts (a paste, a remote update landing in several steps) into
    // one measurement per frame — each pass reads layout.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(root);
    window.addEventListener("resize", schedule);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [container, revision]);

  return tops;
}

/**
 * Paint the highlight state onto the rendered marks.
 *
 * Only marks the rail has a thread for light up. A mark whose comment was never
 * created (the composer was abandoned) or deleted stays in the document as
 * plain text instead of a highlight nobody can open — the document heals itself
 * without a write.
 *
 * Visual state only, no ARIA role: the marks live inside a `contenteditable` in
 * the edit view and cannot be made focusable there without breaking caret
 * navigation. The rail is the keyboard-accessible path to every thread, and it
 * carries the quoted text with it.
 */
export function paintCommentMarks(
  root: HTMLElement,
  state: { live: ReadonlySet<string>; resolved: ReadonlySet<string>; active: string | null },
): void {
  for (const element of commentMarkElements(root)) {
    const id = markIdOf(element);
    const live = id !== null && state.live.has(id);
    element.classList.toggle(MARK_LIVE_CLASS, live);
    element.classList.toggle(MARK_RESOLVED_CLASS, live && id !== null && state.resolved.has(id));
    element.classList.toggle(MARK_ACTIVE_CLASS, live && id === state.active);
  }
}
