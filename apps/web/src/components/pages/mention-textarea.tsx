import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  MentionList,
  type MentionItem,
  type MentionListRef,
} from "@/components/editor/mention/mention-list";
import { orpc } from "@/utils/orpc";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";

/** Matches the `@word` the caret sits in, if any. Names are picked, not typed. */
const ACTIVE_TOKEN = /(^|\s)@([^\s@]{0,40})$/u;

const MAX_SUGGESTIONS = 6;

/**
 * A comment box that can name people. Comment bodies are plain text, so a
 * mention is literally `@Name` — which only becomes a notification if it
 * matches a real member. Picking from this list is what makes that reliable:
 * the exact spelling goes in, including names with a space in them.
 *
 * Reuses the editor's mention dropdown so both places look and key-navigate
 * identically.
 */
export function MentionTextarea({
  spaceId,
  value,
  onChange,
  onSubmit,
  ...props
}: {
  spaceId: string;
  value: string;
  onChange: (next: string) => void;
  /** Ctrl/⌘+Enter, but never while the suggestion list is taking the key. */
  onSubmit?: () => void;
} & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange">) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<MentionListRef>(null);
  const [query, setQuery] = useState<string | null>(null);

  const { data: members } = useQuery(orpc.spaceMembers.list.queryOptions({ input: { spaceId } }));
  const candidates: MentionItem[] = useMemo(
    () =>
      (members ?? [])
        .filter((row) => row.subject === "user" && row.user)
        .map((row) => ({ id: row.user!.id, label: row.user!.name })),
    [members],
  );

  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return candidates
      .filter((item) => item.label.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [candidates, query]);

  const open = query !== null && matches.length > 0;

  /** Re-reads the token under the caret after every edit or cursor move. */
  const syncQuery = (element: HTMLTextAreaElement) => {
    const match = ACTIVE_TOKEN.exec(element.value.slice(0, element.selectionStart));
    setQuery(match ? (match[2] ?? "") : null);
  };

  const insert = (item: MentionItem) => {
    const element = textareaRef.current;
    if (!element) return;
    const caret = element.selectionStart;
    const before = element.value.slice(0, caret);
    const match = ACTIVE_TOKEN.exec(before);
    if (!match) return;
    const start = before.length - match[0].length + match[1]!.length;
    const inserted = `@${item.label} `;
    onChange(before.slice(0, start) + inserted + element.value.slice(caret));
    setQuery(null);
    // Restore focus and put the caret behind the name, so typing continues.
    requestAnimationFrame(() => {
      element.focus();
      const position = start + inserted.length;
      element.setSelectionRange(position, position);
    });
  };

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          syncQuery(event.currentTarget);
        }}
        onClick={(event) => syncQuery(event.currentTarget)}
        onBlur={() => setQuery(null)}
        onKeyDown={(event) => {
          if (open) {
            if (event.key === "Escape") {
              setQuery(null);
              event.preventDefault();
              return;
            }
            // Arrow keys, Enter: the list consumes them while it is open.
            if (listRef.current?.onKeyDown({ event: event.nativeEvent })) {
              event.preventDefault();
              return;
            }
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit?.();
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            requestAnimationFrame(() => syncQuery(event.currentTarget));
          }
        }}
      />
      {open ? (
        // Anchored to the box rather than the caret: a textarea has no caret
        // rectangle, and a list that never jumps is easier to aim at anyway.
        <div
          className="absolute top-full left-0 z-50 mt-1"
          // Keep the caret where it is: blurring the textarea would close this
          // list before the click on an entry ever lands.
          onMouseDown={(event) => event.preventDefault()}
        >
          <MentionList ref={listRef} items={matches} command={insert} />
        </div>
      ) : null}
    </div>
  );
}
