/**
 * Splits a Postgres `ts_headline` snippet on the `<b>…</b>` markers it wraps
 * around matched terms. Returns ordered parts flagged `match` for the wrapped
 * terms. Split-based (never `innerHTML`) so the unescaped page text a snippet
 * contains can't smuggle markup into the DOM — callers render each `value` as
 * plain text and only vary the styling of matches.
 */
export function splitSnippet(snippet: string): { value: string; match: boolean }[] {
  // ts_headline alternates plain/marked segments, so odd indices are matches.
  return snippet.split(/<\/?b>/).map((value, index) => ({ value, match: index % 2 === 1 }));
}
