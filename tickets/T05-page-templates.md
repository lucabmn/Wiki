# T05 — Seitenvorlagen

**Ziel:** Wiederkehrende Seitentypen (Meeting-Notiz, RFC, Runbook, Postmortem)
starten aus einer Vorlage statt aus einer leeren Seite.

## Ist-Zustand

Das Datenmodell ist bereits da — und genau darum ist dieses Ticket kleiner, als
es klingt:

- `packages/db/src/schema/wiki/pages.ts:53` — `page.isTemplate`, boolean,
  `NOT NULL DEFAULT false`.
- `packages/api/src/schemas/page.ts:30,58,124` — im Output-, Create- und
  Update-Schema vorhanden.
- `packages/api/src/routers/page.ts:692` — `create` schreibt das Feld durch.

**Aber:** Es gibt keinen Weg, eine Vorlage anzuwenden, keine Vorlagen-Übersicht,
keinen Schalter in der UI — und einen Bug:

`packages/api/src/routers/page.ts:374-398` (`pages.list`) filtert `isTemplate`
**nicht**. Eine über die API als Vorlage angelegte Seite taucht heute im
normalen Seitenbaum auf. Das gehört mit in dieses Ticket.

## Scope

### 1. Vorlagen aus den normalen Sichten heraushalten

- `pages.list` schließt Vorlagen aus, sofern nicht explizit angefordert
  (neues Input-Feld, Default: ausschließen).
- Ebenso prüfen und anpassen: Suche (`packages/api/src/routers/search.ts` —
  eine Vorlage soll nicht als Suchtreffer erscheinen), Backlinks
  (`routers/link.ts`), Dashboard (`routers/dashboard.ts`), Digest-Sammlung
  (`packages/api/src/lib/notifications/collect.ts` — niemand will eine
  Benachrichtigung über eine geänderte Vorlage), Space-Export
  (`apps/server/src/space-exports.ts`).
- Für jede dieser Stellen ein Test. Das ist der eigentliche Aufwand.

### 2. Vorlagen verwalten

- `pages.listTemplates({ spaceId })` — Vorlagen eines Space.
- Eine bestehende Seite zur Vorlage machen und zurück (`isTemplate` togglen)
  — die Berechtigung dafür ist die gleiche wie fürs Bearbeiten.
- Vorlagen leben im Space, nicht global. Für org-weite Vorlagen siehe offene
  Entscheidung.

### 3. Vorlage anwenden

`pages.createFromTemplate({ templateId, spaceId, parentId, title? })`:

- Kopiert `content` (ProseMirror-JSON) und `textContent` in eine **neue** Seite;
  `isTemplate: false`, `status: "draft"`, frischer Slug über die vorhandene
  Dedup-Logik (`packages/api/src/lib/slug.ts`), Position über
  `packages/api/src/lib/fractional.ts`.
- Kopiert **nicht**: Kommentare, Anhänge, Backlinks, Tags, ACLs, Revisionen.
  Anhänge sind der Fallstrick — sind Bilder im Vorlagen-Dokument über
  Attachment-IDs referenziert, zeigen die Kopien auf die Anhänge der Vorlage.
  Entweder Anhänge mitkopieren (sauber, teurer) oder die Referenzen entfernen.
  Entscheide bewusst und kommentiere die Wahl im Code.
- **Autorisierung:** Der Aufrufer braucht Leserecht auf die Vorlage _und_
  Schreibrecht am Zielort. Nicht nur letzteres — sonst ist eine Vorlage in
  einem restricted Space ein Leseleck.
- Kopiert `yjsState` **nicht** — der Collab-Server (`apps/collab`) seedet das
  Dokument beim ersten Verbinden aus `content`
  (`packages/db/src/schema/wiki/pages.ts:41-45`). Ein kopierter CRDT-Zustand
  würde zwei Seiten dieselbe Dokument-Identität geben.

### 4. UI

- Vorlagen-Auswahl beim Anlegen einer Seite: „Leere Seite" plus die Vorlagen
  des Space (Titel, Icon, kurzer Textauszug).
- Vorlagen-Verwaltung in den Space-Einstellungen
  (`apps/web/src/routes/_auth/spaces/$slug.tsx`).
- Im Seitenkopf eines als Vorlage markierten Dokuments ein deutlicher Hinweis
  samt „Vorlage verwenden"-Aktion.

### 5. Startvorlagen

Das Onboarding legt bereits Beispielinhalte an
(`packages/api/src/routers/onboarding.ts`). Häng dort zwei oder drei nützliche
Vorlagen an — Meeting-Notiz, Entscheidungsvorlage, Runbook. Ein leerer
Vorlagen-Katalog wird nie befüllt.

## Nicht im Scope

- Variablen/Platzhalter in Vorlagen (`{{date}}`, `{{author}}`).
- Vorlagen für Spaces (nur für Seiten).
- Vererbung/Verknüpfung: eine erzeugte Seite ist eine Kopie und bleibt es;
  eine spätere Änderung an der Vorlage wirkt nicht zurück.

## Offene Entscheidung — mit dem Menschen klären, nicht raten

**Org-weite Vorlagen?** Space-lokal ist einfach und passt zum bestehenden
Zugriffsmodell (`packages/api/src/lib/access.ts` gated alles über den Space).
Org-weit ist das, was Nutzer eigentlich wollen, wirft aber die Frage auf, wo
so eine Vorlage lebt und wer sie sehen darf. Vorschlag: **jetzt space-lokal**,
das Feld heißt ohnehin schon `isTemplate` und nicht `isSpaceTemplate` — eine
spätere Erweiterung um einen org-weiten Katalog bleibt möglich.

## Akzeptanzkriterien

`packages/api/tests/integration/page-template.test.ts`:

- Eine Vorlage erscheint **nicht** in `pages.list`, Suche, Backlinks, Dashboard
  und Digest — je ein Test.
- `listTemplates` liefert sie.
- `createFromTemplate` erzeugt eine Seite mit gleichem Inhalt, eigenem Slug,
  `isTemplate: false`, `status: "draft"`.
- Kommentare und Anhänge der Vorlage werden nicht mitkopiert (bzw. gemäß der
  getroffenen Entscheidung dupliziert — Test spiegelt die Entscheidung).
- Ohne Leserecht auf die Vorlage: `FORBIDDEN`, auch mit Schreibrecht am Ziel.
- Vorlage aus einem fremden Space/einer fremden Org: `FORBIDDEN`.
- Die neue Seite hat kein `yjsState`.

## Migrations-Koordination

Keine Schema-Änderung erwartet — `isTemplate` existiert. Falls doch eine nötig
wird, siehe `tickets/README.md`.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
