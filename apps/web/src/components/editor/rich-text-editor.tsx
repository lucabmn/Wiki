import { pageHref } from "@nilovon-wiki/api/lib/page-href";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import type { Editor, JSONContent } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { type ComponentType, useState } from "react";

import { pageEditorExtensions } from "./extensions";
import { LinkPageDialog } from "./link-page-dialog";
import "./editor.css";

/** One toolbar control: reflects and toggles a mark/node on the editor. */
function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // `onMouseDown` + preventDefault keeps the editor selection while clicking.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(active && "bg-primary/10 text-primary")}
    >
      <Icon className="size-4" />
    </Button>
  );
}

function Toolbar({ editor, spaceId }: { editor: Editor; spaceId: string }) {
  const [linkOpen, setLinkOpen] = useState(false);

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-border bg-card/80 px-1.5 py-1 backdrop-blur">
      <ToolButton
        icon={Undo2}
        label="Rückgängig"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolButton
        icon={Redo2}
        label="Wiederholen"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton
        icon={Heading1}
        label="Überschrift 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolButton
        icon={Heading2}
        label="Überschrift 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        icon={Heading3}
        label="Überschrift 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton
        icon={Bold}
        label="Fett"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        icon={Italic}
        label="Kursiv"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        icon={Strikethrough}
        label="Durchgestrichen"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolButton
        icon={Code}
        label="Code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton
        icon={List}
        label="Aufzählung"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        icon={ListOrdered}
        label="Nummerierte Liste"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolButton
        icon={Quote}
        label="Zitat"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton
        icon={Link2}
        label="Seite verknüpfen"
        active={editor.isActive("link")}
        onClick={() => setLinkOpen(true)}
      />
      <LinkPageDialog
        spaceId={spaceId}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onPick={({ id, title }) => {
          const href = pageHref(id);
          const { empty } = editor.state.selection;
          if (empty) {
            // No selection — drop the page title in as a link.
            editor
              .chain()
              .focus()
              .insertContent({
                type: "text",
                text: title,
                marks: [{ type: "link", attrs: { href } }],
              })
              .run();
          } else {
            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }
        }}
      />
    </div>
  );
}

/**
 * Rich-text page editor. Uncontrolled (TipTap owns the document); reports every
 * change up as `{ json, text }` so the parent can autosave the draft and persist
 * on save. `text` is the flattened plain text that feeds the search vector.
 */
export function RichTextEditor({
  spaceId,
  initialContent,
  onChange,
}: {
  spaceId: string;
  initialContent: JSONContent | null;
  onChange: (value: { json: JSONContent; text: string }) => void;
}) {
  const editor = useEditor({
    // `_auth` renders client-only (ssr: false), but keep this off to avoid any
    // hydration mismatch and to match TipTap's SSR-safe guidance.
    immediatelyRender: false,
    extensions: pageEditorExtensions(),
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "tiptap min-h-[320px] px-4 py-3 focus:outline-none",
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange({ json: instance.getJSON(), text: instance.getText() });
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card/40">
      {editor ? <Toolbar editor={editor} spaceId={spaceId} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
