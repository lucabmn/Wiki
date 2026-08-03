export type ExportFormat = "markdown" | "html" | "json";

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
  return format === "markdown" ? "content.md" : format === "html" ? "index.html" : "content.json";
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

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownEscape(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
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

export function documentToHtml(content: unknown, title: string): string {
  const body = htmlNode((content ?? { type: "doc" }) as RichTextNode);
  return `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">\n<title>${htmlEscape(title)}</title>\n<style>body{font:16px/1.6 system-ui,sans-serif;max-width:76ch;margin:3rem auto;padding:0 1rem}img{max-width:100%}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:.35rem .5rem}blockquote{border-left:3px solid #bbb;padding-left:1rem;color:#555}pre{overflow:auto;background:#f5f5f5;padding:1rem}</style>\n</head>\n<body>\n<h1>${htmlEscape(title)}</h1>\n${body}\n</body>\n</html>\n`;
}

function markMarkdown(value: string, node: RichTextNode): string {
  return (node.marks ?? []).reduce((result, mark) => {
    switch (mark.type) {
      case "bold":
        return `**${result}**`;
      case "italic":
        return `_${result}_`;
      case "strike":
        return `~~${result}~~`;
      case "underline":
        return `<u>${result}</u>`;
      case "code":
        return `\`${result.replace(/`/g, "\\`")}\``;
      case "highlight":
        return `<mark>${result}</mark>`;
      case "textStyle":
        return typeof mark.attrs?.color === "string"
          ? `<span style="color:${htmlEscape(mark.attrs.color)}">${result}</span>`
          : result;
      case "subscript":
        return `<sub>${result}</sub>`;
      case "superscript":
        return `<sup>${result}</sup>`;
      case "link":
        return `[${result}](${String(mark.attrs?.href ?? "")})`;
      default:
        return result;
    }
  }, value);
}

function markdownListItem(node: RichTextNode, marker: string, depth: number): string {
  const children = (node.content ?? []).map((item) => markdownNode(item, depth + 1)).join("\n");
  return `${"  ".repeat(depth)}${marker} ${children.replace(/\n/g, `\n${"  ".repeat(depth + 1)}`)}`;
}

function markdownNode(node: RichTextNode, depth = 0): string {
  const children = (node.content ?? []).map((item) => markdownNode(item, depth)).join("");
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((item) => markdownNode(item, depth)).join("\n\n");
    case "text":
      return markMarkdown(markdownEscape(node.text ?? ""), node);
    case "paragraph":
      return children;
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)))} ${children}`;
    case "bulletList":
      return (node.content ?? []).map((item) => markdownListItem(item, "-", depth)).join("\n");
    case "orderedList": {
      const start = Number(node.attrs?.start) || 1;
      return (node.content ?? [])
        .map((item, index) => markdownListItem(item, `${start + index}.`, depth))
        .join("\n");
    }
    case "taskList":
      return (node.content ?? [])
        .map((item) => markdownListItem(item, `- [${item.attrs?.checked ? "x" : " "}]`, depth))
        .join("\n");
    case "listItem":
    case "taskItem":
      return (node.content ?? []).map((item) => markdownNode(item, depth)).join("\n");
    case "blockquote":
      return children
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${(node.content ?? []).map((item) => item.text ?? "").join("")}\n\`\`\``;
    case "hardBreak":
      return "  \n";
    case "horizontalRule":
      return "---";
    case "image":
      return `![${markdownEscape(String(node.attrs?.alt ?? ""))}](${String(node.attrs?.src ?? "")}${node.attrs?.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ""})`;
    case "mention":
      return `@${markdownEscape(String(node.attrs?.label ?? node.attrs?.id ?? ""))}`;
    case "table": {
      const rows = (node.content ?? []).map((row) => markdownNode(row, depth));
      const columns = node.content?.[0]?.content?.length ?? 1;
      if (rows.length)
        rows.splice(1, 0, `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`);
      return rows.join("\n");
    }
    case "tableRow":
      return `| ${(node.content ?? []).map((cell) => markdownNode(cell, depth).replace(/\|/g, "\\|")).join(" | ")} |`;
    case "tableHeader":
    case "tableCell":
      return children.replace(/\n+/g, " ");
    default:
      return children;
  }
}

export function documentToMarkdown(content: unknown, title: string): string {
  const body = markdownNode((content ?? { type: "doc" }) as RichTextNode).trim();
  return `# ${markdownEscape(title)}\n\n${body}\n`;
}
