/**
 * URL-safe slug from arbitrary text. Lowercase, ASCII-ish, dash-separated.
 * Empty input (or input that reduces to nothing) falls back to `fallback`.
 */
export function slugify(input: string, fallback = "untitled"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

/**
 * Ensures `base` is unique against `exists`, appending `-2`, `-3`, ... until a
 * free slug is found. `exists` returns true when a candidate is already taken.
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) {
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}
