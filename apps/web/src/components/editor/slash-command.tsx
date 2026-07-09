import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import {
  Code,
  type LucideIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { type ComponentType, forwardRef, useEffect, useImperativeHandle, useState } from "react";

/** A slash-menu entry: a labelled block transform run on the current selection. */
type SlashCommand = {
  title: string;
  icon: LucideIcon;
  keywords: string[];
  run: (opts: { editor: Editor; range: Range }) => void;
};

const COMMANDS: SlashCommand[] = [
  {
    title: "Text",
    icon: Type,
    keywords: ["absatz", "paragraph", "text"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Überschrift 1",
    icon: Heading1,
    keywords: ["h1", "überschrift", "titel"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Überschrift 2",
    icon: Heading2,
    keywords: ["h2", "überschrift"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Überschrift 3",
    icon: Heading3,
    keywords: ["h3", "überschrift"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Aufzählung",
    icon: List,
    keywords: ["liste", "bullet", "ul"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Nummerierte Liste",
    icon: ListOrdered,
    keywords: ["liste", "nummer", "ol", "ordered"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Aufgabenliste",
    icon: ListChecks,
    keywords: ["todo", "task", "aufgabe", "checkbox", "haken"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Zitat",
    icon: Quote,
    keywords: ["quote", "zitat", "blockquote"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code-Block",
    icon: Code,
    keywords: ["code", "codeblock", "pre"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Tabelle",
    icon: TableIcon,
    keywords: ["tabelle", "table", "grid"],
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: "Trenner",
    icon: Minus,
    keywords: ["divider", "trenner", "hr", "linie"],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

type ListProps = {
  items: SlashCommand[];
  command: (item: SlashCommand) => void;
};
export type SlashListRef = { onKeyDown: (opts: { event: KeyboardEvent }) => boolean };

const SlashCommandList = forwardRef<SlashListRef, ListProps>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);

  // Reset the highlight whenever the filtered set changes.
  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
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
        Keine Befehle
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Editor-Befehle"
      className="max-h-72 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-md"
    >
      {items.map((item, index) => {
        const Icon: ComponentType<{ className?: string }> = item.icon;
        return (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => command(item)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm ${
              index === selected ? "bg-accent text-accent-foreground" : "text-popover-foreground"
            }`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card">
              <Icon className="size-4" />
            </span>
            {item.title}
          </button>
        );
      })}
    </div>
  );
});
SlashCommandList.displayName = "SlashCommandList";

function place(el: HTMLElement, clientRect?: (() => DOMRect | null) | null) {
  const rect = clientRect?.();
  if (!rect) return;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.bottom + 6}px`;
}

/**
 * Notion-style slash menu. Editor-only (not part of the shared read/serialize
 * extensions): typing "/" opens a filterable list of block transforms. Rendered
 * via ReactRenderer into a fixed-position element anchored at the caret.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommand>({
        editor: this.editor,
        char: "/",
        // Only trigger at a block start or after whitespace, so "and/or" won't.
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => props.run({ editor, range }),
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          if (!q) return COMMANDS;
          return COMMANDS.filter(
            (c) => c.title.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)),
          );
        },
        render: () => {
          let component: ReactRenderer<SlashListRef, ListProps> | null = null;
          let el: HTMLElement | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandList, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              });
              el = document.createElement("div");
              el.style.position = "fixed";
              el.style.zIndex = "50";
              el.appendChild(component.element);
              document.body.appendChild(el);
              place(el, props.clientRect);
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: props.command });
              if (el) place(el, props.clientRect);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                el?.remove();
                return true;
              }
              return component?.ref?.onKeyDown({ event: props.event }) ?? false;
            },
            onExit: () => {
              el?.remove();
              el = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
