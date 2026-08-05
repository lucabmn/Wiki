import { MessageSquareText } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { MentionTextarea } from "@/components/pages/mention-textarea";
import type { InlineThread } from "@/lib/inline-comments";
import { Button } from "@nilovon-wiki/ui/components/button";
import { cn } from "@nilovon-wiki/ui/lib/utils";

import { InlineCommentThread, type ThreadPermissions } from "./inline-comment-thread";

export type CommentDraft = { markId: string; excerpt: string; top: number };

/** Minimum gap between two cards once they are pushed apart. */
const CARD_GAP = 8;
/** The `xl` breakpoint — the width at which the rail sits beside the text. */
const BESIDE_TEXT = "(min-width: 1280px)";

/**
 * Pushes each card down towards the highlight it belongs to, stacking whenever
 * two anchors are too close to both fit — the reason the rail reads as a margin
 * instead of a list. Runs imperatively against the measured card heights: the
 * margin doesn't change a card's own height, so this settles in one pass and
 * never feeds back into React state.
 *
 * Skipped when the rail is not beside the text (narrow viewports, where it
 * renders under the document): there, "aligned with the text" means nothing and
 * the offsets would only tear the list apart.
 */
function alignToAnchors(list: HTMLElement): void {
  const cards = [...list.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  const aligned = window.matchMedia(BESIDE_TEXT).matches;
  let cursor = 0;
  for (const [index, card] of cards.entries()) {
    const top = aligned ? Number(card.dataset.top ?? 0) : 0;
    const margin = Math.max(index === 0 ? 0 : CARD_GAP, top - cursor);
    card.style.marginTop = `${margin}px`;
    cursor += margin + card.offsetHeight;
  }
}

/**
 * The margin rail: every inline thread on the page, ordered by where its
 * highlight sits in the document, plus the composer for a comment that is being
 * written right now.
 */
export function InlineCommentRail({
  threads,
  draft,
  draftBody,
  onDraftBodyChange,
  onDraftSubmit,
  onDraftCancel,
  draftPending,
  activeMarkId,
  onActivate,
  resolvedCount,
  showResolved,
  onShowResolvedChange,
  pageId,
  spaceId,
  permissions,
  nameOf,
  hint,
}: {
  threads: InlineThread[];
  draft: CommentDraft | null;
  draftBody: string;
  onDraftBodyChange: (next: string) => void;
  onDraftSubmit: () => void;
  onDraftCancel: () => void;
  draftPending: boolean;
  activeMarkId: string | null;
  onActivate: (markId: string) => void;
  resolvedCount: number;
  showResolved: boolean;
  onShowResolvedChange: (next: boolean) => void;
  pageId: string;
  spaceId: string;
  permissions: ThreadPermissions;
  nameOf: (userId: string | null) => string;
  /** Shown instead of the empty state while the reader can create comments. */
  hint?: string;
}) {
  const list = useRef<HTMLDivElement>(null);

  // Re-aligns after every render that can move a card: a new thread, a reply
  // form opening, a highlight moving because someone typed above it.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    alignToAnchors(element);
    const observer = new ResizeObserver(() => alignToAnchors(element));
    observer.observe(element);
    return () => observer.disconnect();
  });

  const empty = threads.length === 0 && draft === null;

  return (
    <section aria-label="Inline-Kommentare" className="text-[13px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Im Text ({threads.filter((thread) => !thread.resolved).length})
        </h2>
        {resolvedCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="-my-1 h-7 px-2 text-[11px]"
            aria-pressed={showResolved}
            onClick={() => onShowResolvedChange(!showResolved)}
          >
            {showResolved ? "Aufgelöste ausblenden" : `Aufgelöste (${resolvedCount})`}
          </Button>
        ) : null}
      </div>

      {empty ? (
        <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <MessageSquareText className="mt-px size-3.5 shrink-0" />
          {hint ?? "Noch keine Kommentare im Text."}
        </p>
      ) : null}

      <div ref={list} className={cn(empty && "hidden")}>
        {threads.map((thread) => (
          <InlineCommentThread
            key={thread.markId}
            thread={thread}
            pageId={pageId}
            spaceId={spaceId}
            active={thread.markId === activeMarkId}
            permissions={permissions}
            nameOf={nameOf}
            onActivate={() => onActivate(thread.markId)}
          />
        ))}
        {draft ? (
          <div
            data-top={draft.top}
            className="rounded-lg border border-primary/60 bg-card p-3 shadow-sm ring-2 ring-primary/25"
          >
            <p className="mb-2 truncate border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground italic">
              {draft.excerpt}
            </p>
            <MentionTextarea
              spaceId={spaceId}
              value={draftBody}
              onChange={onDraftBodyChange}
              onSubmit={onDraftSubmit}
              placeholder="Kommentar schreiben …"
              rows={3}
              maxLength={10_000}
              autoFocus
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" className="h-7" onClick={onDraftCancel}>
                Abbrechen
              </Button>
              <Button
                size="sm"
                className="h-7"
                disabled={draftPending || !draftBody.trim()}
                onClick={onDraftSubmit}
              >
                {draftPending ? "Senden …" : "Kommentieren"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
