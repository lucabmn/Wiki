import type { Extensions } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";

/**
 * The single TipTap schema used everywhere a page document is touched — the
 * editable editor AND the read-only renderer. They MUST share this exact set:
 * `generateHTML`/`generateText` reproduce a document faithfully only against the
 * same extensions that produced it. Internal page links ride the bundled `link`
 * mark (href `/pages/<id>`, see `@nilovon-wiki/api/lib/page-href`); `openOnClick`
 * is off so the viewer can intercept them for client-side navigation.
 */
export function pageEditorExtensions(placeholder?: string): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 decoration-primary/40",
        },
      },
    }),
    Placeholder.configure({
      placeholder: placeholder ?? "Schreibe etwas, oder füge eine Verknüpfung ein …",
      emptyEditorClass:
        "before:pointer-events-none before:float-left before:h-0 before:text-muted-foreground before:content-[attr(data-placeholder)]",
    }),
  ];
}
