import zlib from "node:zlib";

/** Minimal, valid RGB PNG — enough for PDFKit to embed a real image. */
export function pngFixture(width = 8, height = 8): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  const raw: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(Buffer.from([0]));
    for (let x = 0; x < width; x++) raw.push(Buffer.from([200, 40, 40]));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(raw))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function crc32(buffer: Buffer): number {
  const table: number[] = [];
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** Counts page objects in the (uncompressed) object dictionaries. */
export function pdfPageCount(bytes: Uint8Array): number {
  const source = Buffer.from(bytes).toString("latin1");
  return (source.match(/\/Type\s*\/Page(?![s/])/g) ?? []).length;
}

export function pdfEmbedsImage(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).toString("latin1").includes("/Subtype /Image");
}

/** True when the PDF carries a link annotation to `url`. */
export function pdfLinksTo(bytes: Uint8Array, url: string): boolean {
  return Buffer.from(bytes).toString("latin1").includes(url);
}
