# Tickets

Arbeitsaufträge, die jeweils von **einem** Agenten eigenständig umgesetzt werden.
Jedes Ticket ist so geschrieben, dass es ohne diesen Ordner-Kontext lesbar ist:
Ist-Zustand mit `datei:zeile`, Scope, Nicht-Scope, offene Entscheidungen,
Akzeptanzkriterien als Tests.

| #                                   | Ticket                                | Schema? | Absprache nötig mit                                 |
| ----------------------------------- | ------------------------------------- | ------- | --------------------------------------------------- |
| [T01](T01-webhooks.md)              | Webhooks / Event-Bus                  | ja      | T04 — beide brauchen einen `/internal`-Runner-Token |
| [T02](T02-two-factor-policy.md)     | 2FA org-weit erzwingbar               | ja      | T04 — wer legt `organization_setting` an?           |
| [T03](T03-admin-console.md)         | Admin-Konsole & Impersonation         | ja      | T04 — wer darf eine Löschsperre aufheben?           |
| [T04](T04-data-lifecycle.md)        | Aufbewahrung, Papierkorb, Löschsperre | ja      | T01, T02, T03 (siehe dort)                          |
| [T05](T05-page-templates.md)        | Seitenvorlagen                        | nein    | —                                                   |
| [T06](T06-pdf-export.md)            | PDF-Export                            | nein    | T08 — wird Chromium eingeführt?                     |
| [T07](T07-mention-notifications.md) | @-Mentions benachrichtigen            | evtl.   | T09 — Erwähnungen in Inline-Kommentaren             |
| [T08](T08-mermaid.md)               | Diagramme / Mermaid                   | nein    | T06 (Server-Rendering), T09 (`packages/editor`)     |
| [T09](T09-inline-comments.md)       | Inline-Kommentare                     | nein    | T07, T08 (siehe dort)                               |

Keines dieser Tickets **blockiert** ein anderes — es sind Punkte, an denen zwei
Agenten sonst zwei Lösungen für dasselbe Problem bauen. Wo in einem Ticket
„kurz abstimmen" steht, ist die Frage an den Menschen zu richten, nicht still
selbst zu entscheiden.

## Koordination zwischen parallel laufenden Agenten

**Migrationen sind der Kollisionspunkt.** `packages/db/src/migrations/` ist
fortlaufend nummeriert (aktuell bis `0012_*`) und teilt sich eine
`meta/_journal.json`. Zwei Agenten, die gleichzeitig `db:generate` laufen
lassen, erzeugen beide `0013_*` und überschreiben sich das Journal.

Regel für jedes schema-berührende Ticket (T01, T02, T03, T04, evtl. T07):

1. Schema-Änderung in `packages/db/src/schema/**` **zuletzt** committen.
2. Vor `pnpm db:generate` auf den aktuellen `main` rebasen.
3. Kollidiert die Nummer trotzdem: generierte Migration **löschen**, rebasen,
   neu generieren — niemals eine bestehende `NNNN_*.sql` von Hand umnummerieren.

**`packages/db/src/schema/wiki/enums.ts`** wird von T01, T03 und T04 erweitert
(`activityAction`). Gleiche Regel, gleiche Datei.

Weitere geteilte Dateien, bei denen ein Merge-Konflikt zu erwarten ist — kein
Grund zu warten, nur zum Kleinhalten der Diffs:

- `packages/api/src/routers/index.ts` — T01, T04 registrieren neue Router
- `packages/editor/src/index.ts` — T08, T09 erweitern das geteilte Schema
- `apps/web/src/routes/_auth/settings/` — T01, T02, T04 legen je eine Seite an

## Git-Workflow

Neun Agenten auf `main` kollidieren an weit mehr als nur den Migrationen.

- **Ein Branch pro Ticket:** `feat/t01-webhooks`, `feat/t04-data-lifecycle` usw.
  Niemals direkt auf `main` committen.
- **Commit-Konvention:** Conventional Commits, wie im bestehenden Verlauf —
  `feat(notifications): …`, `fix(settings): …`. Scope ist das Paket oder der
  Fachbereich.
- **PR-Regeln** aus `CONTRIBUTING.md`: ein logischer Change pro PR, Tests für
  Verhaltensänderungen, und `pnpm test` / `pnpm check-types` / `pnpm check`
  müssen laufen.
- **Der Pre-Commit-Hook formatiert mit.** `lefthook.yml` lässt `oxlint --fix`
  und `oxfmt --write` über die gestagten Dateien laufen und staged die
  Korrekturen nach. Das ist kein Fehler — nicht dagegen ankämpfen.

## Setup-Falle, bevor jemand `pnpm dev` tippt

`CONTRIBUTING.md` nennt nur `apps/server/.env` und `apps/web/.env`. `pnpm dev`
startet aber auch den Collab-Service, der `apps/collab/.env` braucht —
`apps/collab/.env.example` existiert, wird in der Anleitung aber nicht erwähnt
(steht so auch in `TODO.md`). Wer der Doku folgt, läuft am ersten Tag dagegen:

```bash
cp apps/collab/.env.example apps/collab/.env
```

Wer als Erstes an dieser Stelle vorbeikommt, korrigiert bitte gleich
`CONTRIBUTING.md` mit.

## Konventionen, die für alle Tickets gelten

- **Sprache der UI:** Neue Strings werden auf **Deutsch** geschrieben, im Stil
  der vorhandenen. Das Projekt hat (noch) keine i18n-Schicht; keiner dieser
  Agenten führt eine ein. Die i18n-Migration ist ein eigenes Vorhaben.
- **Kommentare im Code:** Englisch, im vorhandenen Stil — sie erklären _warum_,
  nicht _was_ (siehe `packages/db/src/schema/wiki/notifications.ts` als
  Referenz für das erwartete Niveau).
- **Autorisierung:** Lesen wird über die Space-Sichtbarkeit gegated
  (`packages/api/src/lib/access.ts`), Mutationen über die Org-Rolle
  (`assertOrgPermission`). Jede Mutation läuft in einer Transaktion und
  schreibt eine Audit-Zeile über `recordActivity`
  (`packages/api/src/lib/activity.ts`).
- **Gate vor „fertig":** `pnpm check` (oxlint + oxfmt),
  `turbo run check-types`, `turbo run test` — alle drei grün.
- **Tests:** Router-Tests nach `packages/api/tests/integration/`,
  Lib-Tests nach `packages/api/tests/lib/`, Web-Tests nach `apps/web/tests/`.
