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

export type HtmlMigrationAsset = {
  key: string;
  placeholder: string;
  sourcePath: string;
  fileName: string;
  mimeType: string;
  file?: File;
  references: Array<{ pageKey: string; kind: "image" | "attachment" }>;
};

export type HtmlMigrationBundle = {
  pages: HtmlImportPreview[];
  assets: HtmlMigrationAsset[];
  ignoredFiles: string[];
};

type AssetCandidate = Omit<HtmlMigrationAsset, "references">;
type ParseContext = {
  registerAsset?: (
    candidate: AssetCandidate,
    reference: { pageKey: string; kind: "image" | "attachment" },
  ) => string;
  dataAssetIndex: number;
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
const REMOVED_TAGS = ["script", "style", "noscript", "iframe", "object", "embed", "form", "nav"];
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
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

function normalizedPath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value.split(/[?#]/)[0] ?? "");
    const parts: string[] = [];
    for (const part of decoded.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return parts.join("/");
  } catch {
    return null;
  }
}

function resolveLocalPath(sourcePath: string, reference: string): string | null {
  if (reference.startsWith("/")) return normalizedPath(reference);
  const directory = sourcePath.includes("/")
    ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1)
    : "";
  return normalizedPath(`${directory}${reference}`);
}

function extensionMimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      pdf: "application/pdf",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

function dataUrlFile(dataUrl: string, fileName: string): File | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    const type = match[1] || "application/octet-stream";
    const raw = match[2] ? atob(match[3] ?? "") : decodeURIComponent(match[3] ?? "");
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    return new File([bytes], fileName, { type });
  } catch {
    return null;
  }
}

function assetCandidate(
  raw: string,
  sourcePath: string,
  kind: "image" | "attachment",
  context: ParseContext,
): AssetCandidate | null {
  const reference = raw.trim();
  if (!reference || reference.startsWith("#")) return null;

  if (reference.startsWith("data:")) {
    if (kind !== "image") return null;
    const mimeType = /^data:([^;,]+)/.exec(reference)?.[1] ?? "application/octet-stream";
    const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const fileName = `eingebettetes-bild-${++context.dataAssetIndex}.${extension}`;
    const file = dataUrlFile(reference, fileName);
    if (!file) return null;
    const key = `data:${sourcePath}:${context.dataAssetIndex}`;
    return {
      key,
      placeholder: `migration-asset:${encodeURIComponent(key)}`,
      sourcePath: key,
      fileName,
      mimeType,
      file,
    };
  }

  const externalReference = reference.startsWith("//") ? `https:${reference}` : reference;
  // Fetching arbitrary remote assets from the server creates an SSRF surface
  // (DNS can change between validation and connection). v1 imports only files
  // supplied by the operator; ordinary external links remain links.
  if (/^https?:\/\//i.test(externalReference)) return null;

  const path = resolveLocalPath(sourcePath, reference);
  if (!path || (/\.html?$/i.test(path) && kind === "attachment")) return null;
  return {
    key: `local:${path.toLowerCase()}`,
    placeholder: `migration-asset:${encodeURIComponent(`local:${path.toLowerCase()}`)}`,
    sourcePath: path,
    fileName: path.split("/").pop() || "asset",
    mimeType: extensionMimeType(path),
  };
}

function inlineChildren(
  element: Element,
  sourcePath: string,
  warnings: string[],
  context: ParseContext,
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
      const candidate = assetCandidate(el.getAttribute("src") ?? "", sourcePath, "image", context);
      const inline = candidate ? INLINE_IMAGE_TYPES.has(candidate.mimeType.toLowerCase()) : false;
      const placeholder = candidate
        ? context.registerAsset?.(candidate, {
            pageKey: sourcePath,
            kind: inline ? "image" : "attachment",
          })
        : null;
      if (placeholder && inline) {
        result.push({
          type: "image",
          attrs: {
            src: placeholder,
            alt: alt || candidate?.fileName || "Importiertes Bild",
            title: compactText(el.getAttribute("title") ?? "") || null,
          },
        });
      } else if (placeholder) {
        result.push(
          ...textNode(alt ? `[Bilddatei: ${alt}]` : `[Bilddatei: ${candidate?.fileName}]`, [
            ...marks,
            { type: "link", attrs: { href: placeholder } },
          ]),
        );
        warnings.push("Ein nicht inline-fähiges Bild wurde als Anhang übernommen.");
      } else {
        result.push(...textNode(alt ? `[Bild: ${alt}]` : "[Bild nicht verfügbar]", marks));
        warnings.push("Ein Bild ohne gültige Quelle konnte nicht übernommen werden.");
      }
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
      const rawHref = el.getAttribute("href") ?? "";
      const candidate = assetCandidate(rawHref, sourcePath, "attachment", context);
      const placeholder = candidate
        ? context.registerAsset?.(candidate, { pageKey: sourcePath, kind: "attachment" })
        : null;
      const href = placeholder || safeHref(rawHref);
      if (href) nextMarks.push({ type: "link", attrs: { href } });
      else if (rawHref)
        warnings.push("Ein lokaler oder unsicherer Link konnte nicht aufgelöst werden.");
    }
    if (BLOCK_TAGS.has(tag)) {
      result.push(...textNode(compactText(el.textContent ?? ""), nextMarks));
    } else {
      result.push(...inlineChildren(el, sourcePath, warnings, context, nextMarks));
    }
  }
  return result;
}

function blocks(
  element: Element,
  sourcePath: string,
  warnings: string[],
  context: ParseContext,
): ImportedDocumentNode[] {
  const result: ImportedDocumentNode[] = [];
  for (const child of element.children) {
    const tag = child.tagName;
    if (/^H[1-6]$/.test(tag)) {
      result.push({
        type: "heading",
        attrs: { level: Math.min(Number(tag.slice(1)), 3) },
        content: inlineChildren(child, sourcePath, warnings, context),
      });
    } else if (tag === "P") {
      result.push({
        type: "paragraph",
        content: inlineChildren(child, sourcePath, warnings, context),
      });
    } else if (tag === "UL" || tag === "OL") {
      const items = [...child.children]
        .filter((item) => item.tagName === "LI")
        .map((item) => {
          const nested = blocks(item, sourcePath, warnings, context);
          const direct = inlineChildren(item, sourcePath, warnings, context);
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
      const content = blocks(child, sourcePath, warnings, context);
      result.push({
        type: "blockquote",
        content: content.length
          ? content
          : [
              {
                type: "paragraph",
                content: inlineChildren(child, sourcePath, warnings, context),
              },
            ],
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
            content: [
              {
                type: "paragraph",
                content: inlineChildren(cell, sourcePath, warnings, context),
              },
            ],
          })),
      }));
      if (rows.length) result.push({ type: "table", content: rows });
    } else if (REMOVED_TAGS.map((value) => value.toUpperCase()).includes(tag)) {
      warnings.push(`Nicht unterstützter Inhalt <${tag.toLowerCase()}> wurde entfernt.`);
    } else {
      const nested = blocks(child, sourcePath, warnings, context);
      if (nested.length) result.push(...nested);
      else {
        const inline = inlineChildren(child, sourcePath, warnings, context);
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

export function parseHtmlSource(
  sourcePath: string,
  html: string,
  parseContext: Partial<ParseContext> = {},
): HtmlImportPreview {
  const document = new DOMParser().parseFromString(html, "text/html");
  const warnings: string[] = [];
  const sourceRoot =
    document.querySelector(
      ".field--name-body, .node__content, main, article, [role='main'], #content",
    ) ?? document.body;
  const root = sourceRoot.cloneNode(true) as Element;
  for (const tag of REMOVED_TAGS) {
    const removed = root.querySelectorAll(tag);
    if (removed.length) warnings.push(`${removed.length}× <${tag}> wurde entfernt.`);
    removed.forEach((element) => element.remove());
  }
  const heading = compactText(root.querySelector("h1")?.textContent ?? "");
  const title = (heading || compactText(document.title) || filenameTitle(sourcePath)).slice(0, 300);
  const context: ParseContext = { dataAssetIndex: 0, ...parseContext };
  const content = blocks(root, sourcePath, warnings, context);
  if (
    content[0]?.type === "heading" &&
    compactText(root.querySelector("h1")?.textContent ?? "") === title
  ) {
    content.shift();
  }
  if (!content.length) content.push({ type: "paragraph" });
  return {
    key: sourcePath,
    parentKey: null,
    sourcePath,
    title,
    content: { type: "doc", content },
    textContent: compactText(root.textContent ?? ""),
    warnings: [...new Set(warnings)],
  };
}

export async function prepareHtmlMigration(files: File[]): Promise<HtmlMigrationBundle> {
  if (!files.length) return { pages: [], assets: [], ignoredFiles: [] };
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file.name));
  if (!htmlFiles.length) throw new Error("Wähle mindestens eine HTML-Datei aus.");
  if (htmlFiles.length > 100) throw new Error("Bitte wähle höchstens 100 HTML-Dateien aus.");

  const filesByPath = new Map<string, { path: string; file: File }>();
  const ignoredFiles: string[] = [];
  for (const file of files) {
    const path = normalizedPath(file.webkitRelativePath || file.name);
    if (!path) throw new Error(`„${file.name}“ hat einen ungültigen Pfad.`);
    const key = path.toLowerCase();
    if (filesByPath.has(key)) throw new Error(`„${path}“ wurde doppelt ausgewählt.`);
    filesByPath.set(key, { path, file });
  }

  const assets = new Map<string, HtmlMigrationAsset>();
  const registerAsset = (
    candidate: AssetCandidate,
    reference: { pageKey: string; kind: "image" | "attachment" },
  ) => {
    let resolved = candidate;
    if (candidate.key.startsWith("local:")) {
      const selected = filesByPath.get(candidate.sourcePath.toLowerCase());
      if (selected) {
        resolved = {
          ...candidate,
          sourcePath: selected.path,
          fileName: selected.file.name,
          mimeType: selected.file.type || extensionMimeType(selected.path),
          file: selected.file,
        };
      }
    }
    const existing = assets.get(candidate.key);
    if (existing) {
      if (
        !existing.references.some(
          (item) => item.pageKey === reference.pageKey && item.kind === reference.kind,
        )
      ) {
        existing.references.push(reference);
      }
    } else {
      assets.set(candidate.key, { ...resolved, references: [reference] });
    }
    return candidate.placeholder;
  };

  const pages: HtmlImportPreview[] = [];
  for (const file of htmlFiles) {
    const sourcePath = normalizedPath(file.webkitRelativePath || file.name)!;
    if (file.size > 2_000_000) throw new Error(`„${file.name}“ ist größer als 2 MB.`);
    pages.push(parseHtmlSource(sourcePath, await file.text(), { registerAsset }));
  }

  const rootPage = pages[0]!;
  for (const { path, file } of filesByPath.values()) {
    if (/\.html?$/i.test(path)) continue;
    const key = `local:${path.toLowerCase()}`;
    if (assets.has(key)) continue;
    const mimeType = file.type || extensionMimeType(path);
    const migratable =
      mimeType.startsWith("image/") ||
      mimeType === "application/pdf" ||
      mimeType === "text/plain" ||
      /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|zip|7z|tar|gz)$/i.test(path);
    if (!migratable) {
      ignoredFiles.push(path);
      continue;
    }
    const placeholder = `migration-asset:${encodeURIComponent(key)}`;
    assets.set(key, {
      key,
      placeholder,
      sourcePath: path,
      fileName: file.name,
      mimeType,
      file,
      references: [{ pageKey: rootPage.key, kind: "attachment" }],
    });
    rootPage.warnings.push(`Nicht verlinktes Asset wird an „${rootPage.title}“ angehängt: ${path}`);
  }

  const byPath = new Map(pages.map((item) => [item.sourcePath.toLowerCase(), item.key]));
  for (const item of pages) {
    const directory = parentPath(item.sourcePath);
    if (directory) {
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
  }

  const missingPlaceholders = new Set<string>();
  for (const asset of assets.values()) {
    if (!asset.file && !asset.remoteUrl) {
      missingPlaceholders.add(asset.placeholder);
      for (const reference of asset.references) {
        const page = pages.find((item) => item.key === reference.pageKey);
        page?.warnings.push(`Asset fehlt: ${asset.sourcePath}`);
      }
    }
  }
  const removeMissing = (node: ImportedDocumentNode): ImportedDocumentNode => {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : null;
    if (node.type === "image" && src && missingPlaceholders.has(src)) {
      return { type: "text", text: `[Fehlendes Bild: ${String(node.attrs?.alt || "ohne Titel")}]` };
    }
    return {
      ...node,
      ...(node.content ? { content: node.content.map(removeMissing) } : {}),
      ...(node.marks
        ? {
            marks: node.marks.filter(
              (mark) =>
                !(
                  mark.type === "link" &&
                  typeof mark.attrs?.href === "string" &&
                  missingPlaceholders.has(mark.attrs.href)
                ),
            ),
          }
        : {}),
    };
  };
  for (const page of pages) page.content = removeMissing(page.content);

  return {
    pages,
    assets: [...assets.values()].filter((asset) => asset.file || asset.remoteUrl),
    ignoredFiles,
  };
}

/** Compatibility helper for callers interested only in converted pages. */
export async function parseHtmlFiles(files: File[]): Promise<HtmlImportPreview[]> {
  return (await prepareHtmlMigration(files)).pages;
}
