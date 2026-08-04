import type { RichTextNode } from "../space-export-format";
import { renderBlocks } from "./pdf-blocks";
import { writeRuns } from "./pdf-inline";
import {
  COLOR,
  MARGINS,
  SIZE,
  SPACING,
  contentWidth,
  createPdfDocument,
  drawTitleBlock,
  stampHeaderAndFooter,
  type PdfDoc,
  type PdfMeta,
} from "./pdf-theme";

/** Resolves an image `src` from the document to raw PNG/JPEG bytes. */
export type PdfImageLoader = (src: string) => Promise<Buffer | null>;

export type PdfRenderOptions = {
  loadImage?: PdfImageLoader;
  /** Maps a document link to the URL the PDF should point at. */
  resolveLink?: (url: string) => string;
  /** Wall-clock ceiling for one page, image fetches included. */
  timeoutMs?: number;
  /** Guard against pathological documents; the overflow is reported in-page. */
  maxNodes?: number;
};

const DEFAULT_MAX_NODES = 20_000;

/**
 * Renders one TipTap document to a PDF.
 *
 * Layout itself is synchronous; the only I/O is fetching image bytes, so all
 * images are resolved first and the page is then laid out in one pass. That is
 * what makes the timeout meaningful — it bounds the part that can actually
 * block — and it keeps the renderer free of interleaved awaits.
 */
export async function documentToPdf(
  content: unknown,
  meta: PdfMeta,
  options: PdfRenderOptions = {},
): Promise<Buffer> {
  const document = (content ?? { type: "doc" }) as RichTextNode;
  const resolveLink = options.resolveLink ?? ((url: string) => url);
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : null;

  const images = await loadImages(document, options.loadImage, deadline);
  if (deadline && Date.now() > deadline) {
    throw new PdfRenderTimeout(`PDF rendering exceeded ${options.timeoutMs} ms`);
  }

  const doc = createPdfDocument(meta);
  const finished = collect(doc);
  doc.addPage();
  drawTitleBlock(doc, meta);

  const { blocks, truncated } = budget(
    document.content ?? [],
    options.maxNodes ?? DEFAULT_MAX_NODES,
  );
  renderBlocks({ doc, resolveLink, images }, blocks);
  if (truncated) {
    writeNotice(
      doc,
      "Der Rest dieser Seite wurde beim PDF-Export ausgelassen: Das Dokument ist zu groß.",
    );
  }

  stampHeaderAndFooter(doc, meta);
  doc.end();
  return finished;
}

export class PdfRenderTimeout extends Error {
  override name = "PdfRenderTimeout";
}

/** Single-page placeholder for a page that could not be rendered. */
export async function placeholderPdf(meta: PdfMeta, reason: string): Promise<Buffer> {
  const doc = createPdfDocument(meta);
  const finished = collect(doc);
  doc.addPage();
  drawTitleBlock(doc, meta);
  writeNotice(doc, reason);
  stampHeaderAndFooter(doc, meta);
  doc.end();
  return finished;
}

function writeNotice(doc: PdfDoc, text: string): void {
  doc.x = MARGINS.left;
  doc.y += SPACING.block;
  writeRuns(doc, [{ text, italic: true }], {
    width: contentWidth(doc),
    size: SIZE.small,
    color: COLOR.muted,
  });
}

function collect(doc: PdfDoc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Every distinct image `src` in the document, in document order. */
export function imageSources(node: RichTextNode): string[] {
  const sources = new Set<string>();
  const walk = (current: RichTextNode) => {
    if (current.type === "image") {
      const source = String(current.attrs?.src ?? "");
      if (source) sources.add(source);
    }
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return [...sources];
}

async function loadImages(
  document: RichTextNode,
  loadImage: PdfImageLoader | undefined,
  deadline: number | null,
): Promise<Map<string, Buffer>> {
  const images = new Map<string, Buffer>();
  if (!loadImage) return images;
  for (const source of imageSources(document)) {
    if (deadline && Date.now() > deadline) break;
    // One failed image must not cost the whole page: it degrades to its alt text.
    const bytes = await loadImage(source).catch(() => null);
    if (bytes) images.set(source, bytes);
  }
  return images;
}

/** Takes top-level blocks until the node budget is spent. */
function budget(
  blocks: RichTextNode[],
  maxNodes: number,
): { blocks: RichTextNode[]; truncated: boolean } {
  let spent = 0;
  const kept: RichTextNode[] = [];
  for (const block of blocks) {
    if (spent >= maxNodes) return { blocks: kept, truncated: true };
    spent += countNodes(block);
    kept.push(block);
  }
  return { blocks: kept, truncated: false };
}

function countNodes(node: RichTextNode): number {
  let total = 1;
  for (const child of node.content ?? []) total += countNodes(child);
  return total;
}
