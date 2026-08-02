export type ImportedDocumentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ImportedDocumentNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export type HtmlImportPreview = {
  key: string;
  parentKey: string | null;
  sourcePath: string;
  title: string;
  content: ImportedDocumentNode;
  textContent: string;
  warnings: string[];
};

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "HR",
]);

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(href)) return href;
  return null;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function textNode(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>) {
  return text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : [];
}

function inlineChildren(
  element: Element,
  warnings: string[],
  marks: Array<{ type: string; attrs?: Record<string, unknown> }> = [],
): ImportedDocumentNode[] {
  const result: ImportedDocumentNode[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType === 3) {
      result.push(...textNode((child.textContent ?? "").replace(/\s+/g, " "), marks));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName;
    if (tag === "BR") {
      result.push({ type: "hardBreak" });
      continue;
    }
    if (tag === "IMG") {
      const alt = compactText(el.getAttribute("alt") ?? "");
      if (alt) result.push(...textNode(`[Bild: ${alt}]`, marks));
      warnings.push("Bilder werden nicht übernommen. Bitte füge sie später als Anhang hinzu.");
      continue;
    }
    const nextMarks = [...marks];
    if (tag === "STRONG" || tag === "B") nextMarks.push({ type: "bold" });
    if (tag === "EM" || tag === "I") nextMarks.push({ type: "italic" });
    if (tag === "S" || tag === "DEL") nextMarks.push({ type: "strike" });
    if (tag === "CODE") nextMarks.push({ type: "code" });
    if (tag === "SUB") nextMarks.push({ type: "subscript" });
    if (tag === "SUP") nextMarks.push({ type: "superscript" });
    if (tag === "A") {
      const href = safeHref(el.getAttribute("href") ?? "");
      if (href) nextMarks.push({ type: "link", attrs: { href } });
      else if (el.hasAttribute("href"))
        warnings.push("Ein Link mit unsicherer oder lokaler URL wurde entfernt.");
    }
    if (BLOCK_TAGS.has(tag)) {
      result.push(...textNode(compactText(el.textContent ?? ""), nextMarks));
    } else {
      result.push(...inlineChildren(el, warnings, nextMarks));
    }
  }
  return result;
}

function blocks(element: Element, warnings: string[]): ImportedDocumentNode[] {
  const result: ImportedDocumentNode[] = [];
  for (const child of element.children) {
    const tag = child.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const level = Math.min(Number(tag.slice(1)), 3);
      result.push({ type: "heading", attrs: { level }, content: inlineChildren(child, warnings) });
    } else if (tag === "P") {
      result.push({ type: "paragraph", content: inlineChildren(child, warnings) });
    } else if (tag === "UL" || tag === "OL") {
      const items = [...child.children]
        .filter((item) => item.tagName === "LI")
        .map((item) => {
          const nested = blocks(item, warnings);
          const direct = inlineChildren(item, warnings);
          return {
            type: "listItem",
            content: [
              ...(direct.length ? [{ type: "paragraph", content: direct }] : []),
              ...nested.filter((node) => node.type === "bulletList" || node.type === "orderedList"),
            ],
          };
        });
      result.push({
        type: tag === "UL" ? "bulletList" : "orderedList",
        ...(tag === "OL"
          ? { attrs: { start: Number(child.getAttribute("start")) || 1, type: null } }
          : {}),
        content: items,
      });
    } else if (tag === "BLOCKQUOTE") {
      const content = blocks(child, warnings);
      result.push({
        type: "blockquote",
        content: content.length
          ? content
          : [{ type: "paragraph", content: inlineChildren(child, warnings) }],
      });
    } else if (tag === "PRE") {
      result.push({
        type: "codeBlock",
        attrs: { language: null },
        content: textNode(child.textContent ?? "", []),
      });
    } else if (tag === "HR") {
      result.push({ type: "horizontalRule" });
    } else if (tag === "TABLE") {
      const rows = [
        ...child.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"),
      ].map((row) => ({
        type: "tableRow",
        content: [...row.children]
          .filter((cell) => cell.tagName === "TD" || cell.tagName === "TH")
          .map((cell) => ({
            type: cell.tagName === "TH" ? "tableHeader" : "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: "paragraph", content: inlineChildren(cell, warnings) }],
          })),
      }));
      if (rows.length) result.push({ type: "table", content: rows });
    } else if (["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "FORM", "NAV"].includes(tag)) {
      warnings.push(`Nicht unterstützter Inhalt <${tag.toLowerCase()}> wurde entfernt.`);
    } else {
      const nested = blocks(child, warnings);
      if (nested.length) result.push(...nested);
      else {
        const inline = inlineChildren(child, warnings);
        if (inline.length) result.push({ type: "paragraph", content: inline });
      }
    }
  }
  return result;
}

function filenameTitle(path: string) {
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function parentPath(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : null;
}

export function parseHtmlSource(sourcePath: string, html: string): HtmlImportPreview {
  const document = new DOMParser().parseFromString(html, "text/html");
  const warnings: string[] = [];
  const root =
    document.querySelector(
      ".field--name-body, .node__content, main, article, [role='main'], #content",
    ) ?? document.body;
  const heading = compactText(root.querySelector("h1")?.textContent ?? "");
  const documentTitle = compactText(document.title);
  const title = (heading || documentTitle || filenameTitle(sourcePath)).slice(0, 300);
  const content = blocks(root, warnings);
  if (
    content[0]?.type === "heading" &&
    compactText(root.querySelector("h1")?.textContent ?? "") === title
  ) {
    content.shift();
  }
  if (!content.length) content.push({ type: "paragraph" });
  const textContent = compactText(root.textContent ?? "");
  return {
    key: sourcePath,
    parentKey: null,
    sourcePath,
    title,
    content: { type: "doc", content },
    textContent,
    warnings: [...new Set(warnings)],
  };
}

export async function parseHtmlFiles(files: File[]): Promise<HtmlImportPreview[]> {
  if (!files.length) return [];
  if (files.length > 100) throw new Error("Bitte wähle höchstens 100 HTML-Dateien aus.");
  const seen = new Set<string>();
  const parsed = await Promise.all(
    files.map(async (file) => {
      const path = (file.webkitRelativePath || file.name).replace(/^\/+/, "");
      if (!/\.html?$/i.test(path)) throw new Error(`„${file.name}“ ist keine HTML-Datei.`);
      if (file.size > 2_000_000) throw new Error(`„${file.name}“ ist größer als 2 MB.`);
      const normalized = path.toLowerCase();
      if (seen.has(normalized)) throw new Error(`„${path}“ wurde doppelt ausgewählt.`);
      seen.add(normalized);
      return parseHtmlSource(path, await file.text());
    }),
  );
  const byPath = new Map(parsed.map((item) => [item.sourcePath.toLowerCase(), item.key]));
  for (const item of parsed) {
    const directory = parentPath(item.sourcePath);
    if (!directory) continue;
    const candidates = [
      `${directory}/index.html`,
      `${directory}/index.htm`,
      `${directory}.html`,
      `${directory}.htm`,
    ];
    item.parentKey =
      candidates
        .map((candidate) => byPath.get(candidate.toLowerCase()))
        .find((key) => key && key !== item.key) ?? null;
  }
  return parsed;
}
