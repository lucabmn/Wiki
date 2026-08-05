import { MERMAID_SOURCE_LIMIT } from "@nilovon-wiki/editor/mermaid-document";

import { sanitizeSvg } from "./sanitize";

export type MermaidResult = { svg: string; error: null } | { svg: null; error: string };

type MermaidModule = (typeof import("mermaid"))["default"];

let loading: Promise<MermaidModule> | null = null;
let configuredTheme: string | null = null;
let sequence = 0;

/**
 * Mermaid is ~500 kB of parser and layout code. It is pulled in on first use
 * only — never at module scope, so no page pays for it until it actually shows
 * a diagram. `tests/mermaid-bundle.test.ts` guards the rule.
 */
function loadMermaid(): Promise<MermaidModule> {
  loading ??= import("mermaid").then((module) => module.default);
  return loading;
}

/**
 * Mermaid keeps one global config, so re-initialize only when the theme
 * actually flips — otherwise every diagram on the page re-configures the
 * library before rendering.
 */
function configure(mermaid: MermaidModule, dark: boolean): void {
  const theme = dark ? "dark" : "default";
  if (theme === configuredTheme) return;
  configuredTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    theme,
    // The security contract, in Mermaid's own terms: no click handlers, no
    // script directives, and labels rendered as SVG text instead of embedded
    // HTML — `sanitize.ts` then re-checks the result.
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
    // On a parse failure Mermaid otherwise paints its own error graphic into
    // the document; we show the message inline instead.
    suppressErrorRendering: true,
    logLevel: "fatal",
    maxTextSize: MERMAID_SOURCE_LIMIT,
    fontFamily: "inherit",
  });
}

/** First line of a Mermaid error, trimmed to something a caption can hold. */
function readableError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((error as { str?: string } | null)?.str ?? "");
  const first = message.split("\n").slice(0, 3).join("\n").trim();
  return first ? first.slice(0, 400) : "Das Diagramm konnte nicht gerendert werden.";
}

/**
 * Renders Mermaid source to sanitized SVG. Never throws: a syntax error comes
 * back as `error` so the caller can show it inline — a diagram that does not
 * parse must not take the editor down with it.
 */
export async function renderMermaid(
  source: string,
  options: { dark: boolean },
): Promise<MermaidResult> {
  const text = source.trim();
  if (!text) return { svg: null, error: "Dieses Diagramm hat noch keinen Quelltext." };
  if (text.length > MERMAID_SOURCE_LIMIT) {
    return {
      svg: null,
      error: `Der Quelltext ist länger als ${MERMAID_SOURCE_LIMIT.toLocaleString("de-DE")} Zeichen.`,
    };
  }
  try {
    const mermaid = await loadMermaid();
    configure(mermaid, options.dark);
    // `parse` reports syntax errors before `render` builds any DOM.
    await mermaid.parse(text);
    const { svg } = await mermaid.render(`mermaid-diagram-${++sequence}`, text);
    const safe = sanitizeSvg(svg);
    return safe
      ? { svg: safe, error: null }
      : { svg: null, error: "Das Diagramm konnte nicht sicher dargestellt werden." };
  } catch (error) {
    return { svg: null, error: readableError(error) };
  }
}
