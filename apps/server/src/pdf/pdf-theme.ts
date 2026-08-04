import PDFDocument from "pdfkit";

/**
 * Print theme for exported PDFs.
 *
 * The PDF is a *document*, not a screenshot of the app: no navigation, no
 * rails, no buttons, and no dark-mode colours — every colour below is fixed and
 * light, so an operator reading the app in dark mode still gets a printable
 * page. Geometry is A4 with margins wide enough that the stamped header and
 * footer bands can never collide with body content.
 */

export type PdfDoc = PDFKit.PDFDocument;

/** Everything the header, footer and title block need to identify the page. */
export type PdfMeta = {
  title: string;
  spaceName: string;
  exportedAt: Date;
  /** Ancestor titles, root first — rendered as a breadcrumb under the title. */
  breadcrumb?: string[];
};

export const MARGINS = { top: 84, bottom: 76, left: 64, right: 64 } as const;

export const COLOR = {
  text: "#18181b",
  muted: "#71717a",
  faint: "#a1a1aa",
  rule: "#e4e4e7",
  link: "#1d4ed8",
  codeBackground: "#f4f4f5",
  codeText: "#27272a",
  quoteBar: "#d4d4d8",
  quoteText: "#3f3f46",
  tableHeader: "#f4f4f5",
  tableBorder: "#d4d4d8",
} as const;

// Standard-14 fonts only: they need no embedded font files, which keeps the
// server image exactly as small as it was. The trade-off is WinAnsi coverage
// (Latin-1) — documented in `docs/export-format.md`.
export const FONT = {
  body: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
  mono: "Courier",
  monoBold: "Courier-Bold",
} as const;

export const SIZE = {
  body: 10.5,
  code: 8.5,
  small: 8,
  title: 21,
  heading: [16.5, 14, 12.5, 11.5, 11, 10.5],
} as const;

// `listIndent` has to hold the widest marker in use — "10." in the body face and
// "[x]" in the monospace face — or the marker wraps into a second line.
export const SPACING = { block: 8, lineGap: 2.5, listIndent: 22 } as const;

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short" });

export function createPdfDocument(meta: PdfMeta): PdfDoc {
  return new PDFDocument({
    size: "A4",
    margins: { ...MARGINS },
    // Header and footer carry "page n of m", so every page has to stay
    // writable until the total is known.
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: meta.title,
      Subject: meta.spaceName,
      Creator: "Wiki",
      Producer: "Wiki",
      CreationDate: meta.exportedAt,
    },
  });
}

export function contentWidth(doc: PdfDoc): number {
  return doc.page.width - MARGINS.left - MARGINS.right;
}

/** Lowest y a block may occupy before it has to move to the next page. */
export function contentBottom(doc: PdfDoc): number {
  return doc.page.height - MARGINS.bottom;
}

/** Break to a new page unless `height` still fits below the cursor. */
export function ensureSpace(doc: PdfDoc, height: number): void {
  if (doc.y + height <= contentBottom(doc)) return;
  // A block taller than a whole page cannot be rescued by a break; letting it
  // start here avoids an empty page in front of it.
  if (height > contentBottom(doc) - MARGINS.top) return;
  doc.addPage();
}

/** Title, breadcrumb and separator at the top of the first page. */
export function drawTitleBlock(doc: PdfDoc, meta: PdfMeta): void {
  const width = contentWidth(doc);
  doc
    .font(FONT.bold)
    .fontSize(SIZE.title)
    .fillColor(COLOR.text)
    .text(meta.title, MARGINS.left, doc.y, { width, lineGap: 1 });

  const trail = [meta.spaceName, ...(meta.breadcrumb ?? [])].filter(Boolean);
  if (trail.length) {
    doc
      .font(FONT.body)
      .fontSize(SIZE.small)
      .fillColor(COLOR.muted)
      .text(trail.join("  ›  "), MARGINS.left, doc.y + 3, { width, lineGap: 0 });
  }

  const ruleY = doc.y + 8;
  doc
    .save()
    .moveTo(MARGINS.left, ruleY)
    .lineTo(doc.page.width - MARGINS.right, ruleY)
    .lineWidth(0.75)
    .strokeColor(COLOR.rule)
    .stroke()
    .restore();
  doc.x = MARGINS.left;
  doc.y = ruleY + 16;
}

/**
 * Stamps every buffered page with the running header and footer. Called once
 * after the body is laid out, because the page total is only known then.
 */
export function stampHeaderAndFooter(doc: PdfDoc, meta: PdfMeta): void {
  const range = doc.bufferedPageRange();
  const width = contentWidth(doc);
  const exportedAt = dateFormat.format(meta.exportedAt);

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    const headerY = MARGINS.top - 40;
    const footerY = doc.page.height - MARGINS.bottom + 30;
    // The footer sits below the text box, and PDFKit answers a write below the
    // bottom margin by starting a new page. Lifting the margin for the stamp is
    // the documented way to write into the footer band.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.font(FONT.body).fontSize(SIZE.small).fillColor(COLOR.muted);
    doc.text(meta.spaceName, MARGINS.left, headerY, {
      width: width * 0.6,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(exportedAt, MARGINS.left + width * 0.6, headerY, {
      width: width * 0.4,
      align: "right",
      lineBreak: false,
    });
    horizontalRule(doc, headerY + 13);

    horizontalRule(doc, footerY - 10);
    doc.fillColor(COLOR.faint);
    doc.text(meta.title, MARGINS.left, footerY, {
      width: width * 0.7,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(`Seite ${index + 1} von ${range.count}`, MARGINS.left + width * 0.7, footerY, {
      width: width * 0.3,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.flushPages();
}

function horizontalRule(doc: PdfDoc, y: number): void {
  doc
    .save()
    .moveTo(MARGINS.left, y)
    .lineTo(doc.page.width - MARGINS.right, y)
    .lineWidth(0.5)
    .strokeColor(COLOR.rule)
    .stroke()
    .restore();
}
