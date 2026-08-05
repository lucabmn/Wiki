import type { RichTextNode } from "../space-export-format";
import { collectRuns, runsToText, writeRuns, type InlineRun } from "./pdf-inline";
import { COLOR, FONT, SIZE, SPACING, contentBottom, ensureSpace, type PdfDoc } from "./pdf-theme";

type BlockContext = {
  doc: PdfDoc;
  resolveLink: (url: string) => string;
  images: Map<string, Buffer>;
};

type Cell = { runs: InlineRun[]; header: boolean; colspan: number };

const PADDING = 5;

/**
 * Tables render row by row so that `break-inside: avoid` holds per row: a row
 * that no longer fits moves to the next page in one piece, and the header row
 * is repeated there. Cell bodies are projected to inline text — the same
 * flattening the Markdown export applies — because a cell is a label, not a
 * canvas for nested blocks.
 */
export function renderTable(
  ctx: BlockContext,
  node: RichTextNode,
  left: number,
  width: number,
): void {
  const { doc } = ctx;
  const rows = (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map((row) => toCells(row, ctx.resolveLink));
  if (!rows.length) return;

  const columns = Math.max(...rows.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)));
  const columnWidth = width / Math.max(1, columns);
  const headerRow = rows[0]?.every((cell) => cell.header) ? rows[0] : null;

  ensureSpace(doc, SIZE.body * 3);
  doc.y += SPACING.block / 2;
  let repeatHeader = false;

  for (const row of rows) {
    const height = rowHeight(doc, row, columnWidth);
    if (doc.y + height > contentBottom(doc)) {
      doc.addPage();
      repeatHeader = Boolean(headerRow);
    }
    if (repeatHeader && headerRow && row !== headerRow) {
      drawRow(ctx, headerRow, left, columnWidth, rowHeight(doc, headerRow, columnWidth));
      repeatHeader = false;
    }
    drawRow(ctx, row, left, columnWidth, height);
  }

  // No outer frame: the per-cell borders already close the grid, and a frame
  // spanning a page break would have to be split page by page.
  doc.y += SPACING.block;
}

function toCells(row: RichTextNode, resolveLink: (url: string) => string): Cell[] {
  return (row.content ?? []).map((cell) => ({
    runs: collectRuns(flattenCell(cell), resolveLink),
    header: cell.type === "tableHeader",
    colspan: Math.max(1, Math.min(16, Number(cell.attrs?.colspan) || 1)),
  }));
}

/** Collapses a cell's block children into one inline sequence. */
function flattenCell(cell: RichTextNode): RichTextNode[] {
  const inline: RichTextNode[] = [];
  for (const [index, child] of (cell.content ?? []).entries()) {
    if (index > 0) inline.push({ type: "hardBreak" });
    if (child.type === "text" || child.type === "mention") inline.push(child);
    else inline.push(...(child.content ?? []));
  }
  return inline;
}

/**
 * Measured with the bold face throughout: bold is the widest of the faces in
 * use, so a mixed-weight cell can only ever come out shorter than measured —
 * never taller, which would overflow the row.
 */
function rowHeight(doc: PdfDoc, row: Cell[], columnWidth: number): number {
  const heights = row.map((cell) =>
    doc
      .font(FONT.bold)
      .fontSize(SIZE.body)
      .heightOfString(runsToText(cell.runs) || " ", {
        width: columnWidth * cell.colspan - PADDING * 2,
        lineGap: SPACING.lineGap,
      }),
  );
  return Math.max(SIZE.body * 1.6, ...heights) + PADDING * 2;
}

function drawRow(
  ctx: BlockContext,
  row: Cell[],
  left: number,
  columnWidth: number,
  height: number,
): void {
  const { doc } = ctx;
  const top = doc.y;
  let x = left;

  for (const cell of row) {
    const width = columnWidth * cell.colspan;
    doc.save();
    if (cell.header) doc.rect(x, top, width, height).fill(COLOR.tableHeader);
    doc.lineWidth(0.5).strokeColor(COLOR.tableBorder).rect(x, top, width, height).stroke();
    doc.restore();

    doc.x = x + PADDING;
    doc.y = top + PADDING;
    writeRuns(doc, cell.runs, { width: width - PADDING * 2, bold: cell.header });
    x += width;
  }
  doc.x = left;
  doc.y = top + height;
}
