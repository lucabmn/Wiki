import { Readable } from "node:stream";

import type { PdfImageLoader } from "./document-to-pdf";

/**
 * Turns the image references in a page document into bytes the PDF can embed.
 *
 * A PDF whose images point at a private object store is an empty PDF, so the
 * bytes have to travel into the file itself. PDFKit embeds JPEG and PNG only;
 * anything else degrades to the image's alt text rather than failing the page.
 */

export type AttachmentImage = { storageKey: string; mimeType: string; size: number };

export type ImageStorage = { download: (key: string) => Promise<{ stream: () => ReadableStream }> };

const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/jpg"]);

/** `/attachments/<id>/inline` or `.../download` → the attachment id. */
export function attachmentIdFromUrl(url: string): string | null {
  const match = /^\/attachments\/([^/?#]+)\/(?:inline|download)(?:[?#].*)?$/.exec(url);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export type ImageLoaderOptions = {
  storage: ImageStorage | null;
  /** Resolves an attachment id to its row, or null when it may not be read. */
  resolve: (id: string) => Promise<AttachmentImage | null>;
  /** Per-image ceiling; larger images are skipped rather than buffered. */
  maxBytes: number;
  /** Ceiling for the shared cache across all pages of one export. */
  cacheBytes: number;
};

/**
 * Builds a loader with a bounded, export-scoped cache: a logo repeated on 400
 * pages is fetched once, and the cache stops growing at `cacheBytes` instead of
 * holding a whole Space's images in memory.
 */
export function createImageLoader(options: ImageLoaderOptions): PdfImageLoader {
  const cache = new Map<string, Buffer>();
  let cached = 0;

  return async (source: string) => {
    const inline = dataUrlBytes(source, options.maxBytes);
    if (inline) return inline;

    const id = attachmentIdFromUrl(source);
    if (!id) return null;
    const hit = cache.get(id);
    if (hit) return hit;

    const row = await options.resolve(id);
    if (!row || !options.storage) return null;
    if (!EMBEDDABLE.has(row.mimeType.toLowerCase()) || row.size > options.maxBytes) return null;

    const stored = await options.storage.download(row.storageKey);
    const bytes = await readCapped(stored.stream(), options.maxBytes);
    if (!bytes) return null;
    if (cached + bytes.length <= options.cacheBytes) {
      cache.set(id, bytes);
      cached += bytes.length;
    }
    return bytes;
  };
}

function dataUrlBytes(source: string, maxBytes: number): Buffer | null {
  const match = /^data:(image\/(?:png|jpe?g));base64,([\s\S]+)$/i.exec(source.trim());
  if (!match?.[2]) return null;
  // 4 base64 characters carry 3 bytes; reject before allocating.
  if ((match[2].length * 3) / 4 > maxBytes) return null;
  const bytes = Buffer.from(match[2], "base64");
  return bytes.length ? bytes : null;
}

async function readCapped(stream: ReadableStream, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0])) {
    const buffer = Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) return null;
    chunks.push(buffer);
  }
  return total ? Buffer.concat(chunks) : null;
}
