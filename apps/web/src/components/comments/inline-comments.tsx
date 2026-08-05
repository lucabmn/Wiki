import {
  createCommentAnchor,
  newCommentMarkId,
  toExcerpt,
} from "@nilovon-wiki/editor/comment-anchor";
import { COMMENT_MARK_ATTRIBUTE } from "@nilovon-wiki/editor/comment-mark";
import type { Editor } from "@tiptap/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { toast } from "sonner";

import { buildInlineThreads, splitComments } from "@/lib/inline-comments";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";

import { CommentBubble } from "./comment-bubble";
import { InlineCommentRail, type CommentDraft } from "./inline-comment-rail";
import { findCommentMark, markIdOf, paintCommentMarks, useCommentMarks } from "./use-comment-marks";

/**
 * Everything inline comments need on a page, for both the editable and the
 * read-only body: the margin rail, the highlight ↔ rail focus link, and — when
 * an editor is mounted — the selection bubble that starts a new one.
 *
 * The document side is addressed through `contentRef` and the rendered marks,
 * never through the editor state, so a reader who never opens the editor gets
 * the identical experience. Returns nothing when there is nothing to show and
 * nothing to create, so the route's rail column can collapse itself.
 */
export function InlineComments({
  pageId,
  spaceId,
  contentRef,
  editor,
  canComment,
  canModerate,
  viewerId,
  nameOf,
  anchored = true,
}: {
  pageId: string;
  spaceId: string;
  /** Wrapper around the rendered document — editable surface or read-only HTML. */
  contentRef: RefObject<HTMLElement | null>;
  /** Present only while editing; enables creating and withdrawing anchors. */
  editor?: Editor | null;
  canComment: boolean;
  canModerate: boolean;
  viewerId: string | null;
  nameOf: (userId: string | null) => string;
  /** Passed through to the rail: false when it is stacked under the metadata. */
  anchored?: boolean;
}) {
  const invalidate = useInvalidate(orpc.comments.list.key());
  const { data } = useQuery(orpc.comments.list.queryOptions({ input: { pageId } }));

  const [showResolved, setShowResolved] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ markId: string; excerpt: string } | null>(null);
  const [draftBody, setDraftBody] = useState("");

  const inline = useMemo(() => splitComments(data ?? []).inline, [data]);
  const positions = useCommentMarks(contentRef, editor);
  const threads = useMemo(() => buildInlineThreads(inline, positions), [inline, positions]);

  const visible = useMemo(
    () => (showResolved ? threads : threads.filter((thread) => !thread.resolved)),
    [threads, showResolved],
  );
  const resolvedCount = threads.filter((thread) => thread.resolved).length;

  // Only threads the rail is actually showing light up in the text. A mark left
  // behind by an abandoned composer or a deleted comment reads as plain text.
  const live = useMemo(() => {
    const ids = new Set(visible.map((thread) => thread.markId));
    if (draft) ids.add(draft.markId);
    return ids;
  }, [visible, draft]);
  const resolvedIds = useMemo(
    () => new Set(threads.filter((thread) => thread.resolved).map((thread) => thread.markId)),
    [threads],
  );

  useEffect(() => {
    const root = contentRef.current;
    if (root) paintCommentMarks(root, { live, resolved: resolvedIds, active });
  }, [contentRef, live, resolvedIds, active, positions]);

  // Clicking annotated text focuses its thread. Overlapping anchors nest, so the
  // innermost mark under the pointer wins — the other card stays one click away.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const mark = target?.closest<HTMLElement>(`[${COMMENT_MARK_ATTRIBUTE}]`);
      const id = mark ? markIdOf(mark) : null;
      if (!id || !live.has(id)) return;
      setActive(id);
      const card = [...root.ownerDocument.querySelectorAll<HTMLElement>("[data-mark-id]")].find(
        (element) => element.dataset.markId === id,
      );
      card?.scrollIntoView({ block: "nearest" });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [contentRef, live]);

  const focusInDocument = useCallback(
    (markId: string) => {
      setActive(markId);
      const root = contentRef.current;
      if (root) findCommentMark(root, markId)?.scrollIntoView({ block: "nearest" });
    },
    [contentRef],
  );

  const startDraft = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const excerpt = toExcerpt(editor.state.doc.textBetween(from, to, " "));
    if (!excerpt) return;
    const markId = newCommentMarkId();
    editor.chain().focus().setCommentMark(markId).run();
    setDraft({ markId, excerpt });
    setDraftBody("");
    setActive(markId);
  }, [editor]);

  const cancelDraft = useCallback(() => {
    if (draft) editor?.commands.unsetCommentMark(draft.markId);
    setDraft(null);
    setDraftBody("");
  }, [draft, editor]);

  const create = useMutation(
    orpc.comments.create.mutationOptions({
      onSuccess: () => {
        invalidate();
        setDraft(null);
        setDraftBody("");
        toast.success("Kommentar hinzugefügt");
      },
      // The anchor stays in the document on failure so the text the comment was
      // about is still selected when the author retries.
      onError: toastError,
    }),
  );

  const submitDraft = () => {
    const body = draftBody.trim();
    if (!draft || !body) return;
    create.mutate({
      pageId,
      body,
      anchor: createCommentAnchor(draft.markId, draft.excerpt),
    });
  };

  const railDraft: CommentDraft | null = draft
    ? { ...draft, top: positions.get(draft.markId) ?? 0 }
    : null;

  // `threads`, not `visible`: a page whose only threads are resolved still needs
  // the rail, or nothing would offer to unhide them.
  if (!threads.length && !railDraft && !editor) return null;

  return (
    <>
      {/* Withdrawn while a draft is open: the selection is still standing, and
          a second "Kommentieren" next to the live composer only asks which one
          the author meant. */}
      {editor && canComment && !draft ? (
        <CommentBubble editor={editor} onComment={startDraft} />
      ) : null}
      <InlineCommentRail
        threads={visible}
        draft={railDraft}
        draftBody={draftBody}
        onDraftBodyChange={setDraftBody}
        onDraftSubmit={submitDraft}
        onDraftCancel={cancelDraft}
        draftPending={create.isPending}
        activeMarkId={active}
        onActivate={focusInDocument}
        resolvedCount={resolvedCount}
        showResolved={showResolved}
        onShowResolvedChange={setShowResolved}
        pageId={pageId}
        spaceId={spaceId}
        permissions={{ canComment, canModerate, viewerId }}
        nameOf={nameOf}
        anchored={anchored}
        hint={
          canComment
            ? "Markiere Text im Dokument und wähle „Kommentieren“."
            : "Zum Kommentieren fehlt dir die Berechtigung."
        }
      />
    </>
  );
}
