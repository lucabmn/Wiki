import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Label } from "@nilovon-wiki/ui/components/label";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { MERMAID_CAPTION_LIMIT, MERMAID_SOURCE_LIMIT } from "@nilovon-wiki/editor/mermaid-document";
import type { NodeViewRenderer } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { MermaidDiagramView } from "./diagram";

/** What a new diagram starts with, so the block is never an empty white box. */
export const MERMAID_TEMPLATE = `flowchart TD
  A[Idee] --> B{Passt?}
  B -- ja --> C[Umsetzen]
  B -- nein --> D[Verwerfen]`;

/** How long typing pauses before the preview re-renders and the node is updated. */
const COMMIT_DELAY = 400;

function MermaidNodeView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const source = String(node.attrs.source ?? "");
  const caption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  // A diagram inserted from the slash menu opens straight into its source, so
  // the first thing the author sees is the thing they came to write.
  const [editing, setEditing] = useState(() => editor.isEditable && !source.trim());
  const [draft, setDraft] = useState(source);
  const [preview, setPreview] = useState(source);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  // `updateAttributes` is a fresh closure on every render; a ref keeps it out of
  // the debounce effect's dependencies, which would otherwise restart the timer
  // on each keystroke and never fire.
  const commit = useRef(updateAttributes);
  commit.current = updateAttributes;

  // Follow collaborators while this client is not the one typing.
  useEffect(() => {
    if (editing) return;
    setDraft(source);
    setPreview(source);
  }, [editing, source]);

  // One debounce for both jobs: refresh the preview and write the source into
  // the shared document. Per keystroke that would be a Mermaid parse and a Yjs
  // transaction for every collaborator.
  useEffect(() => {
    if (!editing) return;
    const timer = setTimeout(() => {
      setPreview(draft);
      if (draft !== source) commit.current({ source: draft });
    }, COMMIT_DELAY);
    return () => clearTimeout(timer);
  }, [draft, editing, source]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const stopEditing = () => {
    setPreview(draft);
    if (draft !== source) updateAttributes({ source: draft });
    setEditing(false);
    editor.commands.focus();
  };

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        "group relative my-4 rounded-xl transition-colors",
        selected && "ring-2 ring-ring/60",
      )}
      data-mermaid-node="true"
    >
      {editing ? (
        <div className="grid gap-4 rounded-xl border border-border bg-muted/20 p-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-source`}>Mermaid-Quelltext</Label>
            <Textarea
              id={`${fieldId}-source`}
              ref={textareaRef}
              value={draft}
              spellCheck={false}
              rows={10}
              maxLength={MERMAID_SOURCE_LIMIT}
              className="min-h-48 resize-y font-mono text-xs"
              placeholder="flowchart TD&#10;  A --> B"
              onChange={(event) => setDraft(event.target.value)}
              // The editor listens on the document; without this, keys typed
              // here would also reach ProseMirror's shortcut handling.
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" || (event.key === "Enter" && event.metaKey)) {
                  event.preventDefault();
                  stopEditing();
                }
              }}
            />
            <Label htmlFor={`${fieldId}-caption`}>Beschriftung (optional)</Label>
            <Input
              id={`${fieldId}-caption`}
              value={caption}
              maxLength={MERMAID_CAPTION_LIMIT}
              placeholder="Wird unter dem Diagramm angezeigt"
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => updateAttributes({ caption: event.target.value || null })}
            />
            <p className="text-xs text-muted-foreground">
              Die Beschriftung ist der einzige Teil des Diagramms, den die Volltextsuche findet.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm leading-none font-medium">Vorschau</span>
            <MermaidDiagramView source={preview} caption={caption} className="my-0" />
          </div>
          <div className="flex justify-end gap-1 md:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => deleteNode()}>
              <Trash2 />
              Löschen
            </Button>
            <Button type="button" size="sm" onClick={stopEditing}>
              <Check />
              Fertig
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Double-click opens the source, the same gesture the editor uses for
              images and tables; the buttons below stay the accessible path. */}
          <div onDoubleClick={editor.isEditable ? () => setEditing(true) : undefined}>
            <MermaidDiagramView source={preview} caption={caption} />
          </div>
          {editor.isEditable ? (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Diagramm bearbeiten"
                title="Diagramm bearbeiten"
                onClick={() => setEditing(true)}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Diagramm löschen"
                title="Diagramm löschen"
                onClick={() => deleteNode()}
              >
                <Trash2 />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </NodeViewWrapper>
  );
}

/**
 * The browser half of the diagram node: source editing plus a live, sanitized
 * preview. Passed to `pageEditorExtensions({ mermaidNodeView })` — the node spec
 * itself stays in `@nilovon-wiki/editor`, which the collab server shares.
 */
export function createMermaidNodeView(): NodeViewRenderer {
  return ReactNodeViewRenderer(MermaidNodeView);
}
