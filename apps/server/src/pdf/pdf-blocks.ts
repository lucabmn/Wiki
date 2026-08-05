import type { RichTextNode } from "../space-export-format";
import { collectRuns, writeRuns } from "./pdf-inline";
import {
  COLOR,
  FONT,
  MARGINS,
  SIZE,
  SPACING,
  contentBottom,
  contentWidth,
  ensureSpace,
  type PdfDoc,
} from "./pdf-theme";
import { renderTable } from "./pdf-table";

export type BlockContext = {
  doc: PdfDoc;
  resolveLink: (url: string) => string;
  /** Image bytes keyed by their original `src`, pre-loaded before layout. */
  images: Map<string, Buffer>;
};

/** Renders a list of block nodes at `indent` points from the left margin. */
export function renderBlocks(ctx: BlockContext, nodes: RichTextNode[], indent = 0): void {
  for (const node of nodes) renderBlock(ctx, node, indent);
}

function renderBlock(ctx: BlockContext, node: RichTextNode, indent: number): void {
  const { doc } = ctx;
  const left = MARGINS.left + indent;
  const width = contentWidth(doc) - indent;
  doc.x = left;

  switch (node.type) {
    case "paragraph":
      renderParagraph(ctx, node, left, width);
      break;
    case "heading":
      renderHeading(ctx, node, left, width);
      break;
    case "bulletList":
      renderList(ctx, node, indent, () => "•");
      break;
    case "orderedList": {
      const start = Number(node.attrs?.start) || 1;
      renderList(ctx, node, indent, (index) => `${start + index}.`);
      break;
    }
    case "taskList":
      renderList(ctx, node, indent, (_index, item) => (item.attrs?.checked ? "[x]" : "[ ]"), true);
      break;
    case "listItem":
    case "taskItem":
      renderBlocks(ctx, node.content ?? [], indent);
      break;
    case "blockquote":
      renderBlockquote(ctx, node, indent);
      break;
    case "codeBlock":
      renderCodeBlock(ctx, node, left, width);
      break;
    case "horizontalRule":
      renderRule(doc, left, width);
      break;
    case "image":
      renderImage(ctx, node, left, width);
      break;
    case "table":
      renderTable(ctx, node, left, width);
      break;
    default:
      if (node.content?.length) renderBlocks(ctx, node.content, indent);
      break;
  }
}

function renderParagraph(ctx: BlockContext, node: RichTextNode, left: number, width: number): void {
  // A paragraph that only wraps an image is a figure, not a sentence.
  const images = (node.content ?? []).filter((child) => child.type === "image");
  const inline = (node.content ?? []).filter((child) => child.type !== "image");
  if (inline.length || !images.length) {
    ctx.doc.x = left;
    writeRuns(ctx.doc, collectRuns(inline, ctx.resolveLink), {
      width,
      align: alignOf(node),
    });
    ctx.doc.y += SPACING.block;
  }
  for (const image of images) renderImage(ctx, image, left, width);
}

function renderHeading(ctx: BlockContext, node: RichTextNode, left: number, width: number): void {
  const { doc } = ctx;
  const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
  const size = SIZE.heading[level - 1] ?? SIZE.body;
  const runs = collectRuns(node.content, ctx.resolveLink);
  const height = doc
    .font(FONT.bold)
    .fontSize(size)
    .heightOfString(runs.map((r) => r.text).join(""), {
      width,
    });
  // Keep-with-next: a heading alone at the foot of a page reads as a mistake.
  ensureSpace(doc, height + SIZE.body * 3);
  doc.y += level <= 2 ? SPACING.block : SPACING.block / 2;
  doc.x = left;
  writeRuns(doc, runs, { width, size, bold: true, align: alignOf(node), lineGap: 1 });
  doc.y += SPACING.block / 2;
}

function renderList(
  ctx: BlockContext,
  node: RichTextNode,
  indent: number,
  marker: (index: number, item: RichTextNode) => string,
  monoMarker = false,
): void {
  const { doc } = ctx;
  const items = node.content ?? [];
  items.forEach((item, index) => {
    ensureSpace(doc, SIZE.body * 2);
    const top = doc.y;
    doc
      .font(monoMarker ? FONT.mono : FONT.body)
      .fontSize(monoMarker ? SIZE.code : SIZE.body)
      .fillColor(COLOR.muted)
      .text(marker(index, item), MARGINS.left + indent, top + 1, {
        width: SPACING.listIndent - 4,
        align: monoMarker ? "left" : "right",
        lineBreak: false,
      });
    // The marker is decoration, not flow: the item body starts on its own line.
    doc.y = top;
    doc.fillColor(COLOR.text);
    renderBlocks(ctx, item.content ?? [], indent + SPACING.listIndent);
    doc.y -= SPACING.block / 2;
  });
  doc.y += SPACING.block / 2;
}

/**
 * Renders the quote body first, then draws the accent bar over every page the
 * body touched — the only way to get a continuous bar across a page break.
 */
function renderBlockquote(ctx: BlockContext, node: RichTextNode, indent: number): void {
  const { doc } = ctx;
  const barX = MARGINS.left + indent + 1;
  const startPage = currentPageIndex(doc);
  const startY = doc.y + 2;

  renderBlocks(ctx, node.content ?? [], indent + 12);
  const endPage = currentPageIndex(doc);
  const endY = doc.y - SPACING.block / 2;

  for (let index = startPage; index <= endPage; index++) {
    doc.switchToPage(index);
    const top = index === startPage ? startY : MARGINS.top;
    const bottom = index === endPage ? endY : contentBottom(doc);
    if (bottom <= top) continue;
    doc
      .save()
      .moveTo(barX, top)
      .lineTo(barX, bottom)
      .lineWidth(2.5)
      .strokeColor(COLOR.quoteBar)
      .stroke()
      .restore();
  }
  doc.switchToPage(endPage);
  doc.x = MARGINS.left + indent;
  doc.y = endY + SPACING.block / 2;
}

function currentPageIndex(doc: PdfDoc): number {
  const range = doc.bufferedPageRange();
  return range.start + range.count - 1;
}

/**
 * Code renders line by line: the background band is painted per line, so a long
 * block flows across pages with its band intact instead of being clipped, and
 * long lines are hard-wrapped rather than cut off at the right margin.
 */
function renderCodeBlock(ctx: BlockContext, node: RichTextNode, left: number, width: number): void {
  const { doc } = ctx;
  const padding = 7;
  const source = (node.content ?? []).map((child) => child.text ?? "").join("");
  doc.font(FONT.mono).fontSize(SIZE.code);
  const columns = Math.max(8, Math.floor((width - padding * 2) / doc.widthOfString("0")));
  const lines = source
    .replace(/\t/g, "  ")
    .split("\n")
    .flatMap((line) => wrap(line, columns));
  const lineHeight = doc.currentLineHeight() + 1.5;

  ensureSpace(doc, Math.min(lines.length, 4) * lineHeight + padding * 2);
  band(doc, left, width, padding);
  for (const line of lines) {
    if (doc.y + lineHeight + padding > contentBottom(doc)) {
      band(doc, left, width, padding);
      doc.addPage();
      band(doc, left, width, padding);
    }
    const y = doc.y;
    doc.rect(left, y, width, lineHeight).fill(COLOR.codeBackground);
    doc
      .font(FONT.mono)
      .fontSize(SIZE.code)
      .fillColor(COLOR.codeText)
      .text(line || " ", left + padding, y + 1, { width: width - padding * 2, lineBreak: false });
    doc.y = y + lineHeight;
  }
  band(doc, left, width, padding);
  doc.fillColor(COLOR.text);
  doc.y += SPACING.block;
}

function band(doc: PdfDoc, left: number, width: number, height: number): void {
  doc.rect(left, doc.y, width, height).fill(COLOR.codeBackground);
  doc.y += height;
}

function wrap(line: string, columns: number): string[] {
  if (line.length <= columns) return [line];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += columns) {
    chunks.push(line.slice(index, index + columns));
  }
  return chunks;
}

function renderRule(doc: PdfDoc, left: number, width: number): void {
  ensureSpace(doc, SPACING.block * 2);
  const y = doc.y + SPACING.block / 2;
  doc
    .save()
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(0.75)
    .strokeColor(COLOR.rule)
    .stroke()
    .restore();
  doc.y = y + SPACING.block;
}

function renderImage(ctx: BlockContext, node: RichTextNode, left: number, width: number): void {
  const { doc } = ctx;
  const source = String(node.attrs?.src ?? "");
  const caption = String(node.attrs?.title ?? node.attrs?.alt ?? "").trim();
  const bytes = ctx.images.get(source);
  if (!bytes) {
    doc.x = left;
    writeRuns(
      doc,
      [{ text: caption ? `[Bild: ${caption}]` : "[Bild nicht verfügbar]", italic: true }],
      {
        width,
        size: SIZE.small,
        color: COLOR.muted,
      },
    );
    doc.y += SPACING.block;
    return;
  }

  const image = openImage(doc, bytes);
  const maxHeight = contentBottom(doc) - MARGINS.top;
  const scale = Math.min(1, width / image.width, maxHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  ensureSpace(doc, drawHeight + (caption ? SIZE.small * 2 : 0));
  doc.image(image as unknown as Buffer, left, doc.y, { width: drawWidth, height: drawHeight });
  doc.y += drawHeight + 3;
  if (caption) {
    doc.x = left;
    writeRuns(doc, [{ text: caption, italic: true }], {
      width,
      size: SIZE.small,
      color: COLOR.muted,
    });
  }
  doc.y += SPACING.block;
}

type OpenedImage = { width: number; height: number };

/**
 * Decodes the image once so its natural size is known before placing it.
 * `openImage` is part of PDFKit's public API but missing from its types.
 */
function openImage(doc: PdfDoc, bytes: Buffer): OpenedImage {
  return (doc as unknown as { openImage: (src: Buffer) => OpenedImage }).openImage(bytes);
}

function alignOf(node: RichTextNode): "left" | "center" | "right" | "justify" {
  const value = node.attrs?.textAlign;
  return value === "center" || value === "right" || value === "justify" ? value : "left";
}
