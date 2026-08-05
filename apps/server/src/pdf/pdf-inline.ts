import type { RichTextNode } from "../space-export-format";
import { COLOR, FONT, SIZE, SPACING, type PdfDoc } from "./pdf-theme";

/**
 * Inline text runs. A block's inline children are flattened into styled runs
 * first and only then written, because PDFKit lays out styled text as a chain
 * of `continued` calls — which needs the whole chain up front to know where it
 * ends.
 */
export type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  link?: string;
  scale?: number;
};

export type InlineOptions = {
  width: number;
  size?: number;
  align?: "left" | "center" | "right" | "justify";
  lineGap?: number;
  bold?: boolean;
  color?: string;
};

/** Flattens inline nodes (text, hard breaks, mentions) into styled runs. */
export function collectRuns(
  nodes: RichTextNode[] | undefined,
  resolveLink: (url: string) => string,
): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      runs.push({ text: "\n" });
    } else if (node.type === "text") {
      if (node.text) runs.push(applyMarks({ text: node.text }, node, resolveLink));
    } else if (node.type === "mention") {
      const label = String(node.attrs?.label ?? node.attrs?.id ?? "");
      if (label) runs.push({ text: `@${label}`, color: COLOR.link });
    } else if (node.type === "image") {
      // An image nested inside a paragraph is rendered as a block by the caller;
      // its alt text keeps the sentence readable when the bytes are missing.
      const alt = String(node.attrs?.alt ?? "").trim();
      if (alt) runs.push({ text: alt, italic: true, color: COLOR.muted });
    } else if (node.content?.length) {
      runs.push(...collectRuns(node.content, resolveLink));
    }
  }
  return runs;
}

function applyMarks(
  run: InlineRun,
  node: RichTextNode,
  resolveLink: (url: string) => string,
): InlineRun {
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        run.bold = true;
        break;
      case "italic":
        run.italic = true;
        break;
      case "underline":
        run.underline = true;
        break;
      case "strike":
        run.strike = true;
        break;
      case "code":
        run.mono = true;
        run.color ??= "#b91c1c";
        break;
      case "subscript":
      case "superscript":
        run.scale = 0.75;
        break;
      case "textStyle":
      case "highlight":
        if (typeof mark.attrs?.color === "string" && mark.type === "textStyle") {
          run.color = safeColor(mark.attrs.color) ?? run.color;
        }
        break;
      case "link": {
        const href = resolveLink(String(mark.attrs?.href ?? ""));
        if (href && href !== "#") {
          run.link = href;
          run.color = COLOR.link;
          run.underline = true;
        }
        break;
      }
      default:
        break;
    }
  }
  return run;
}

/** Only literal colours reach the PDF; anything else keeps the theme colour. */
function safeColor(value: string): string | null {
  const color = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : null;
}

function fontFor(run: InlineRun): string {
  if (run.mono) return run.bold ? FONT.monoBold : FONT.mono;
  if (run.bold && run.italic) return FONT.boldItalic;
  if (run.bold) return FONT.bold;
  if (run.italic) return FONT.italic;
  return FONT.body;
}

/**
 * Writes a run chain at the current cursor. Every text option is passed
 * explicitly on every call: PDFKit carries options over within a `continued`
 * chain, so an unset `link` or `underline` would bleed into the next run.
 */
export function writeRuns(doc: PdfDoc, runs: InlineRun[], options: InlineOptions): void {
  const size = options.size ?? SIZE.body;
  const visible = runs.filter((run) => run.text.length > 0);
  if (!visible.length) {
    doc.font(FONT.body).fontSize(size).text(" ", { width: options.width });
    return;
  }

  visible.forEach((run, index) => {
    const bold = run.bold || options.bold;
    doc
      .font(fontFor({ ...run, bold }))
      .fontSize(run.scale ? size * run.scale : run.mono ? size * 0.92 : size)
      .fillColor(run.color ?? options.color ?? COLOR.text)
      .text(run.text, {
        width: options.width,
        align: options.align ?? "left",
        lineGap: options.lineGap ?? SPACING.lineGap,
        continued: index < visible.length - 1,
        underline: run.underline ?? false,
        strike: run.strike ?? false,
        link: run.link ?? null,
      });
  });
  doc.fillColor(COLOR.text);
}

/** Plain-text projection of inline content — used to measure table cells. */
export function runsToText(runs: InlineRun[]): string {
  return runs.map((run) => run.text).join("");
}
