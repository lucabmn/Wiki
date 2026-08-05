import {
  containsMermaidDiagram,
  MERMAID_LANGUAGE,
  MERMAID_NODE_NAME,
} from "@nilovon-wiki/editor/mermaid-document";

export type ExportFormat = "markdown" | "html" | "json" | "pdf";

export type RichTextNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: RichTextNode[];
};

export function normalizeDocument(
  content: unknown,
  textContent: string,
): { content: RichTextNode; warnings: string[] } {
  if (isRichTextNode(content, 0) && content.type === "doc") {
    return { content, warnings: [] };
  }
  return {
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: textContent ? [{ type: "text", text: textContent }] : [] },
      ],
    },
    warnings: ["Malformed rich-text content was replaced with its plain-text projection."],
  };
}

function isRichTextNode(value: unknown, depth: number): value is RichTextNode {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 100) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string") return false;
  if (node.text !== undefined && typeof node.text !== "string") return false;
  if (
    node.attrs !== undefined &&
    (!node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs))
  )
    return false;
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) return false;
    if (
      !node.marks.every(
        (mark) =>
          mark &&
          typeof mark === "object" &&
          !Array.isArray(mark) &&
          typeof (mark as Record<string, unknown>).type === "string",
      )
    )
      return false;
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) return false;
    if (!node.content.every((item) => isRichTextNode(item, depth + 1))) return false;
  }
  return true;
}

export function safeArchiveName(value: string, fallback = "item"): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  if (!safe) return fallback;
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
}

export function contentFileName(format: ExportFormat): string {
  switch (format) {
    case "markdown":
      return "content.md";
    case "html":
      return "index.html";
    case "pdf":
      return "content.pdf";
    default:
      return "content.json";
  }
}

export function rewriteDocumentUrls(value: unknown, resolveUrl: (url: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteDocumentUrls(item, resolveUrl));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if ((key === "src" || key === "href") && typeof item === "string") {
      result[key] = resolveUrl(item);
    } else {
      result[key] = rewriteDocumentUrls(item, resolveUrl);
    }
  }
  return result;
}

export function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markHtml(value: string, node: RichTextNode): string {
  return (node.marks ?? []).reduce((result, mark) => {
    switch (mark.type) {
      case "bold":
        return `<strong>${result}</strong>`;
      case "italic":
        return `<em>${result}</em>`;
      case "strike":
        return `<s>${result}</s>`;
      case "underline":
        return `<u>${result}</u>`;
      case "code":
        return `<code>${result}</code>`;
      case "highlight":
        return `<mark${typeof mark.attrs?.color === "string" ? ` style="background-color:${htmlEscape(mark.attrs.color)}"` : ""}>${result}</mark>`;
      case "textStyle":
        return typeof mark.attrs?.color === "string"
          ? `<span style="color:${htmlEscape(mark.attrs.color)}">${result}</span>`
          : result;
      case "subscript":
        return `<sub>${result}</sub>`;
      case "superscript":
        return `<sup>${result}</sup>`;
      case "link":
        return `<a href="${htmlEscape(safeHtmlUrl(mark.attrs?.href, "link"))}" rel="noopener noreferrer">${result}</a>`;
      default:
        return result;
    }
  }, value);
}

function htmlNode(node: RichTextNode): string {
  const children = (node.content ?? []).map(htmlNode).join("");
  switch (node.type) {
    case "doc":
      return children;
    case "text":
      return markHtml(htmlEscape(node.text), node);
    case "paragraph":
      return `<p${textAlignAttribute(node)}>${children}</p>`;
    case "heading":
      return `<h${Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))}${textAlignAttribute(node)}>${children}</h${Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))}>`;
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol${Number(node.attrs?.start) > 1 ? ` start="${Number(node.attrs?.start)}"` : ""}>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "taskList":
      return `<ul class="task-list">${children}</ul>`;
    case "taskItem":
      return `<li class="task-item"><input type="checkbox" disabled${node.attrs?.checked ? " checked" : ""}>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock":
      return `<pre><code${node.attrs?.language ? ` class="language-${htmlEscape(node.attrs.language)}"` : ""}>${children}</code></pre>`;
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    case "image":
      return `<img src="${htmlEscape(safeHtmlUrl(node.attrs?.src, "image"))}" alt="${htmlEscape(node.attrs?.alt)}"${node.attrs?.title ? ` title="${htmlEscape(node.attrs.title)}"` : ""}>`;
    case "mention":
      return `<span class="mention">@${htmlEscape(node.attrs?.label ?? node.attrs?.id)}</span>`;
    // Diagrams ship as source, not as an image: rendering Mermaid server-side
    // needs a DOM (jsdom) or Chromium, and the export is not worth that
    // dependency (see T08, "Offene Entscheidung"). `<pre class="mermaid">` is
    // the shape Mermaid's own browser script picks up, so the block renders as
    // soon as the export is viewed with Mermaid available — and stays readable
    // text otherwise. The note in `documentToHtml` says so in the document.
    case MERMAID_NODE_NAME:
      return `<figure class="mermaid-diagram"><pre class="${MERMAID_LANGUAGE}">${htmlEscape(node.attrs?.source)}</pre>${
        node.attrs?.caption ? `<figcaption>${htmlEscape(node.attrs.caption)}</figcaption>` : ""
      }</figure>`;
    case "table":
      return `<table>${children}</table>`;
    case "tableRow":
      return `<tr>${children}</tr>`;
    case "tableHeader":
      return `<th${cellSpanAttributes(node)}>${children}</th>`;
    case "tableCell":
      return `<td${cellSpanAttributes(node)}>${children}</td>`;
    default:
      return children;
  }
}

function safeHtmlUrl(value: unknown, kind: "link" | "image"): string {
  const url = String(value ?? "").trim();
  if (/^https?:/i.test(url)) return url;
  if (kind === "link" && /^mailto:/i.test(url)) return url;
  if (!/^[A-Za-z][A-Za-z\d+.-]*:/.test(url) && !url.includes("\\")) return url || "#";
  return kind === "link" ? "#" : "";
}

function cellSpanAttributes(node: RichTextNode): string {
  const colspan = Number(node.attrs?.colspan);
  const rowspan = Number(node.attrs?.rowspan);
  return `${Number.isInteger(colspan) && colspan > 1 ? ` colspan="${colspan}"` : ""}${Number.isInteger(rowspan) && rowspan > 1 ? ` rowspan="${rowspan}"` : ""}`;
}

function textAlignAttribute(node: RichTextNode): string {
  const alignment = node.attrs?.textAlign;
  return alignment === "left" ||
    alignment === "center" ||
    alignment === "right" ||
    alignment === "justify"
    ? ` style="text-align:${alignment}"`
    : "";
}

/** Told to the reader once per page, not per diagram. */
const MERMAID_EXPORT_NOTE =
  "Hinweis: Diagramme sind als Mermaid-Quelltext eingebettet und werden in diesem Export nicht gezeichnet.";

export function documentToHtml(content: unknown, title: string): string {
  const document = (content ?? { type: "doc" }) as RichTextNode;
  const body = htmlNode(document);
  const note = containsMermaidDiagram(document)
    ? `<p class="export-note">${htmlEscape(MERMAID_EXPORT_NOTE)}</p>\n`
    : "";
  return `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">\n<title>${htmlEscape(title)}</title>\n<style>body{font:16px/1.6 system-ui,sans-serif;max-width:76ch;margin:3rem auto;padding:0 1rem}img{max-width:100%}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:.35rem .5rem}blockquote{border-left:3px solid #bbb;padding-left:1rem;color:#555}pre{overflow:auto;background:#f5f5f5;padding:1rem}figure{margin:1.5rem 0}figcaption{color:#555;font-size:.9em;text-align:center}.export-note{color:#555;font-size:.9em;border-left:3px solid #bbb;padding-left:1rem}</style>\n</head>\n<body>\n<h1>${htmlEscape(title)}</h1>\n${note}${body}\n</body>\n</html>\n`;
}
