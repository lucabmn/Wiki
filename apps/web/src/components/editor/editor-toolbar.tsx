import { pageHref } from "@nilovon-wiki/api/lib/page-href";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@nilovon-wiki/ui/components/popover";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import type { Editor } from "@tiptap/react";
import type { ComponentProps } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import { useState } from "react";

import { LinkPageDialog } from "./link-page-dialog";

/** One toolbar control: reflects and toggles a mark/node on the editor. */
function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
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

/**
 * Trigger for a toolbar dropdown — an icon + caret, active-highlighted. Forwards
 * any props the menu primitive injects (via `render`) down to the button so the
 * dropdown actually opens.
 */
function MenuTrigger({
  icon: Icon,
  label,
  active,
  className,
  ...props
}: { icon: LucideIcon; label: string; active?: boolean } & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      {...props}
      className={cn("gap-0.5 px-1.5", active && "bg-primary/10 text-primary", className)}
    >
      <Icon className="size-4" />
      <ChevronDown className="size-3 opacity-60" />
    </Button>
  );
}

const TEXT_COLORS = [
  { label: "Standard", value: null },
  { label: "Rot", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Grün", value: "#16a34a" },
  { label: "Blau", value: "#2563eb" },
  { label: "Violett", value: "#7c3aed" },
];

const HIGHLIGHTS = [
  { label: "Gelb", value: "#fef08a" },
  { label: "Grün", value: "#bbf7d0" },
  { label: "Blau", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
];

function ColorPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Farbe"
            aria-label="Farbe"
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "gap-0.5 px-1.5",
              (editor.isActive("textStyle") || editor.isActive("highlight")) &&
                "bg-primary/10 text-primary",
            )}
          >
            <Baseline className="size-4" />
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        }
      />
      <PopoverContent className="w-56 space-y-3 p-3">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Baseline className="size-3.5" /> Textfarbe
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.label}
                type="button"
                title={color.label}
                onClick={() => {
                  const chain = editor.chain().focus();
                  if (color.value) chain.setColor(color.value).run();
                  else chain.unsetColor().run();
                  setOpen(false);
                }}
                className="flex size-7 items-center justify-center rounded-md border border-border"
                style={{ color: color.value ?? "var(--foreground)" }}
              >
                <span className="text-sm font-semibold">A</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Highlighter className="size-3.5" /> Markieren
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HIGHLIGHTS.map((color) => (
              <button
                key={color.label}
                type="button"
                title={color.label}
                onClick={() => {
                  editor.chain().focus().toggleHighlight({ color: color.value }).run();
                  setOpen(false);
                }}
                className="size-7 rounded-md border border-border"
                style={{ backgroundColor: color.value }}
              />
            ))}
            <button
              type="button"
              title="Markierung entfernen"
              onClick={() => {
                editor.chain().focus().unsetHighlight().run();
                setOpen(false);
              }}
              className="flex size-7 items-center justify-center rounded-md border border-border text-xs text-muted-foreground"
            >
              ✕
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ALIGNMENTS = [
  { value: "left", label: "Linksbündig", icon: AlignLeft },
  { value: "center", label: "Zentriert", icon: AlignCenter },
  { value: "right", label: "Rechtsbündig", icon: AlignRight },
  { value: "justify", label: "Blocksatz", icon: AlignJustify },
] as const;

function currentAlignIcon(editor: Editor): LucideIcon {
  const active = ALIGNMENTS.find((a) => editor.isActive({ textAlign: a.value }));
  return active?.icon ?? AlignLeft;
}

export function EditorToolbar({ editor, spaceId }: { editor: Editor; spaceId: string }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const inTable = editor.isActive("table");

  return (
    <div className="sticky top-0 z-10 -mx-1.5 flex flex-wrap items-center gap-0.5 border-b border-border bg-background/85 px-1.5 py-1 backdrop-blur">
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
      <ToolButton
        icon={Superscript}
        label="Hochgestellt"
        active={editor.isActive("superscript")}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      />
      <ToolButton
        icon={Subscript}
        label="Tiefgestellt"
        active={editor.isActive("subscript")}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      />
      <ColorPopover editor={editor} />
      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Lists — consolidated into one dropdown. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <MenuTrigger
              icon={List}
              label="Listen"
              active={
                editor.isActive("bulletList") ||
                editor.isActive("orderedList") ||
                editor.isActive("taskList")
              }
            />
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="size-4" /> Aufzählung
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="size-4" /> Nummerierte Liste
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleTaskList().run()}>
            <ListChecks className="size-4" /> Aufgabenliste
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Alignment. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <MenuTrigger
              icon={currentAlignIcon(editor)}
              label="Ausrichtung"
              active={ALIGNMENTS.some(
                (a) => a.value !== "left" && editor.isActive({ textAlign: a.value }),
              )}
            />
          }
        />
        <DropdownMenuContent align="start">
          {ALIGNMENTS.map((align) => (
            <DropdownMenuItem
              key={align.value}
              onClick={() => editor.chain().focus().setTextAlign(align.value).run()}
            >
              <align.icon className="size-4" /> {align.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton
        icon={Quote}
        label="Zitat"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />

      {/* Table. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<MenuTrigger icon={TableIcon} label="Tabelle" active={inTable} />}
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            <TableIcon className="size-4" /> Tabelle einfügen
          </DropdownMenuItem>
          {inTable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
                Spalte hinzufügen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
                Spalte löschen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
                Zeile hinzufügen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>
                Zeile löschen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
                Kopfzeile umschalten
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                Tabelle löschen
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

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
