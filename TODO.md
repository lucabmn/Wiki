# TODO — Offene Punkte aus dem Code-/UX-Audit (2026-07-09)

Behobene Punkte des Audits (ACL-Bypässe, Fehlerzustände, Bestätigungsdialoge,
Space-Verwaltung, Breadcrumbs u. a.) sind nicht mehr aufgeführt — dies sind die
bewusst offen gelassenen, größeren Brocken.

## 1. Bilder / Dateien / Medien im Editor (Feature, hoch)

Das gemeinsame Schema (`packages/editor/src/index.ts`) hat keinen Image- oder
Attachment-Node; Slash-Menü und Toolbar bieten kein Einfügen von
Bildern/Embeds/Callouts. Backend-Seite existiert bereits teilweise
(`attachment`-Router registriert hochgeladene Objekte, Upload out-of-band via
Storage-Key). Fehlt: Upload-Flow im Frontend, Image-Node im TipTap-Schema,
Rendering in Lese-Ansicht, Anzeige in Suche.

## 2. i18n-Schicht (strukturell, mittel)

Sämtliche Copy ist hart deutsch inline (`lib/labels.ts`, jede Route/Komponente,
Editor-Placeholder in `packages/editor/src/index.ts`, `<html lang="de">` in
`__root.tsx`). Für ein Open-Source-Produkt braucht es eine Übersetzungsschicht
(z. B. i18next/paraglide) + Extraktion der Strings. Groß, aber je später,
desto teurer.

## 3. Kleinere offene Befunde

Behoben (2026-07-10): Slug-Race → `CONFLICT` (`lib/pg-errors.ts`),
RPC-Batch-Rate-Limit batch-bewusst, Slash-Menü-Tastatur (Tab/Home/End + sauberes
Escape), Optimistic Toggles (Favorit/Abo), Collab-Socket periodische
TTL-Re-Validierung.

Bewusst offen gelassen:

- **Duplizierte Logik**: Snippet-Highlighter (`search.tsx` vs.
  `command-palette.tsx`), `splitRoles` (`settings/members.tsx` vs. `groups.tsx`),
  Member-Add/Remove-Block (`space-settings-sheet.tsx` vs.
  `page-access-sheet.tsx`). Bei nächster Berührung zusammenziehen.
- **Hardcodierte Farben**: `editor-toolbar.tsx` TEXT_COLORS/HIGHLIGHTS und
  `page-editor.tsx` `userColor` sind bewusst konkrete Werte (Inhalts-/Cursor-
  Farben, die in Dokumente serialisiert werden — kein Token-Kandidat).
  Verbleibend nur vereinzelte UI-Chrome-Fälle (`emerald-500`/`amber-500`), die
  erst mit passenden semantischen Tokens umgestellt werden sollten.
