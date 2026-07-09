# TODO — Offene Punkte aus dem Code-/UX-Audit (2026-07-09)

Behobene Punkte des Audits (ACL-Bypässe, Fehlerzustände, Bestätigungsdialoge,
Space-Verwaltung, Breadcrumbs u. a.) sind nicht mehr aufgeführt — dies sind die
bewusst offen gelassenen, größeren Brocken.

## 1. Editor-Speichersemantik überarbeiten (UX, hoch)

Der Collab-Server projiziert das live Yjs-Dokument per Debounce in
`page.content`/`textContent` (siehe Doku-Kommentar in
`apps/web/src/components/editor/page-editor.tsx`), die Lese-Ansicht rendert
`page.content`. Folgen:

- "Abbrechen" im Editor verwirft Body-Änderungen **nicht** — sie sind bereits
  persistiert. Falsche Affordanz.
- Änderungen an bereits veröffentlichten Seiten erreichen den gespeicherten
  Inhalt, bevor "Veröffentlichen" geklickt wird — andere Nutzer sehen
  unveröffentlichte Edits.
- Titel ist lokaler State (nicht kollaborativ) ohne `useBlocker`/`beforeunload`
  — Navigation mitten im Edit verliert Titeländerungen stumm.

Braucht Architektur-Entscheidung: Draft-Branch (Edits in separatem Doc bis
Publish) vs. Publish-Snapshot (Lese-Ansicht rendert letzte Revision statt
live `content`). Danach Cancel/Publish-Buttons an die echte Semantik anpassen.

## 2. Bilder / Dateien / Medien im Editor (Feature, hoch)

Das gemeinsame Schema (`packages/editor/src/index.ts`) hat keinen Image- oder
Attachment-Node; Slash-Menü und Toolbar bieten kein Einfügen von
Bildern/Embeds/Callouts. Backend-Seite existiert bereits teilweise
(`attachment`-Router registriert hochgeladene Objekte, Upload out-of-band via
Storage-Key). Fehlt: Upload-Flow im Frontend, Image-Node im TipTap-Schema,
Rendering in Lese-Ansicht, Anzeige in Suche.

## 3. i18n-Schicht (strukturell, mittel)

Sämtliche Copy ist hart deutsch inline (`lib/labels.ts`, jede Route/Komponente,
Editor-Placeholder in `packages/editor/src/index.ts`, `<html lang="de">` in
`__root.tsx`). Für ein Open-Source-Produkt braucht es eine Übersetzungsschicht
(z. B. i18next/paraglide) + Extraktion der Strings. Groß, aber je später,
desto teurer.

## 4. Kleinere offene Befunde

- **Member-E-Mails sichtbar für alle Space-Leser**: `spaceMembers.list` und
  `pageAccess.get` liefern `email` an jeden mit Leserecht
  (`packages/api/src/routers/space-member.ts`, `page-access.ts`). Entscheiden:
  E-Mail nur für Manager ausliefern oder bewusst so lassen (Confluence zeigt
  sie auch).
- **Collab-Socket revalidiert nur beim Connect**
  (`apps/collab/src/index.ts`): Entzogener Seitenzugriff wirkt erst beim
  Disconnect. Periodische Re-Validierung offener Verbindungen oder TTL-basierte
  Re-Auth über den bestehenden Token-Mechanismus.
- **Slug-Race → 500 statt 409**: `uniqueSlug`-Check-then-insert in
  `packages/api/src/routers/page.ts` / `space.ts`; parallele Creates kollidieren
  auf dem Unique-Index. Unique-Violation abfangen und als `CONFLICT` mappen.
- **RPC-Batch multipliziert Rate-Limit**: `BatchHandlerPlugin` (10 Calls/Batch)
  zählt als 1 Request im `/rpc`-Limiter (`apps/server/src/index.ts`). Limiter
  batch-bewusst machen oder Batchgröße einpreisen.
- **Slash-Menü-Tastatur-Lücken**: nur Arrow/Enter, kein Tab/Home/End; Escape
  räumt DOM-Node direkt ab statt Suggestion sauber zu beenden
  (`apps/web/src/components/editor/slash-command.tsx`).
- **Duplizierte Logik**: Snippet-Highlighter (`search.tsx` vs.
  `command-palette.tsx`), `splitRoles` (`settings/members.tsx` vs. `groups.tsx`),
  Member-Add/Remove-Block (`space-settings-sheet.tsx` vs.
  `page-access-sheet.tsx`). Bei nächster Berührung zusammenziehen.
- **Optimistic Updates** für Favorit/Abo/Archiv-Toggles auf der Seitenansicht
  (`apps/web/src/routes/_auth/pages/$id.tsx`) — fühlt sich träge an.
- **Hardcodierte Farben** am Design-System vorbei: `editor-toolbar.tsx`
  (TEXT_COLORS/HIGHLIGHTS als Hex), `page-editor.tsx` (`userColor` HSL),
  vereinzelt `emerald-500`/`amber-500` — auf Tokens umstellen, sonst bricht
  Theming.
