import { htmlEscape, type RichTextNode } from "./space-export-format";

/**
 * Markdown projection of a TipTap document. Portable by design: node and mark
 * types Markdown cannot express degrade to the inline HTML that every Markdown
 * renderer understands, rather than being dropped.
 */

function markdownEscape(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
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
