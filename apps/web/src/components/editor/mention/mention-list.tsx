import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export type MentionItem = { id: string; label: string };

type MentionListProps = {
  items: MentionItem[];
  command: (item: MentionItem) => void;
};

export type MentionListRef = { onKeyDown: (opts: { event: KeyboardEvent }) => boolean };

/**
 * Dropdown of matching people for `@` mentions. Keyboard-navigable; mirrors the
 * slash-command list so the two editor popups look and behave identically.
 */
export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (!items.length) return false;
        if (event.key === "ArrowUp") {
          setSelected((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div className="w-64 rounded-xl border border-border bg-popover p-1.5 text-sm text-muted-foreground shadow-md">
          Niemand gefunden
        </div>
      );
    }

    return (
      <div className="max-h-72 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-md">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => setSelected(index)}
            onClick={() => command(item)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm ${
              index === selected ? "bg-accent text-accent-foreground" : "text-popover-foreground"
            }`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-medium uppercase">
              {item.label.slice(0, 2)}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = "MentionList";
