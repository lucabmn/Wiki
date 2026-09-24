/**
 * `head()` payload for a route's document title — "Suche · Wiki". Pass the
 * trail from specific to general: `pageTitle("Profil", "Einstellungen")`.
 */
export function pageTitle(...parts: string[]) {
  return { meta: [{ title: [...parts, "Wiki"].join(" · ") }] };
}
