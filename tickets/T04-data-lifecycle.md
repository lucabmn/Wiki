# T04 — Datenlebenszyklus: Aufbewahrungsfristen, Papierkorb mit Ablauf, Löschsperre

**Ziel:** Ein Betreiber kann festlegen, wie lange Daten leben — und im Einzelfall
verhindern, dass etwas gelöscht wird.

## Warum das ein Ticket ist und nicht drei

Die drei ursprünglich getrennten Features teilen sich zwingend dieselbe
Infrastruktur:

- **eine** Richtlinien-Tabelle (Fristen pro Org),
- **einen** Purge-Runner (sonst laufen zwei Jobs mit unterschiedlichen
  Vorstellungen davon, was gelöscht werden darf),
- und die Löschsperre muss **beide** Löschpfade blockieren — den Audit-Purge
  _und_ den Papierkorb-Ablauf.

Drei Agenten bauen hier zwangsläufig drei Purge-Jobs, die sich gegenseitig die
Daten wegräumen. Ein Agent, drei Phasen.

## Ist-Zustand

- `packages/db/src/schema/wiki/activity.ts` — Audit-Log wächst unbegrenzt, kein
  `deletedAt`, keine Aufbewahrungsfrist, kein Purge.
- `packages/db/src/schema/wiki/pages.ts:56` — `page.archivedAt` existiert;
  `packages/api/src/routers/page.ts:901,942` — `archive` und `restore`.
  Archivieren ist aber **nicht** Löschen: archivierte Seiten bleiben ewig, es
  gibt keinen Ablauf und keinen endgültigen Löschvorgang mit Frist.
- `packages/db/src/schema/wiki/comments.ts` — `comment.deletedAt` existiert
  (Soft-Delete), wird aber nie aufgeräumt.
- `packages/api/src/routers/page.ts` kennt `page.deleted` als Audit-Aktion,
  d. h. es gibt bereits harte Löschungen ohne Rückholmöglichkeit.
- Kein Konzept von Löschsperre / Legal Hold.
- **Bekannter offener Punkt aus `TODO.md`:** Spaces lassen sich archivieren,
  aber nicht regulär wiederherstellen, und für Seiten fehlt die Restore-UI,
  obwohl die API existiert. Das gehört hierher.

## Scope

### Phase 1 — Richtlinie und Purge-Runner (Fundament)

Neue Tabelle, org-skaliert. Falls T02 bereits eine `organization_setting`-Tabelle
angelegt hat: dort andocken statt eine zweite anzulegen — kurz abstimmen.

Felder mindestens:

- `auditRetentionDays` (nullable = unbegrenzt aufbewahren, Default: unbegrenzt —
  eine stillschweigende Löschung von Audit-Daten nach einem Update wäre
  inakzeptabel)
- `trashRetentionDays` (Default z. B. 30)
- `timestamps`

Runner, exakt nach dem Muster von `apps/server/src/digests.ts`:

- In-Process-Ticker + `POST /internal/retention/run`
  (Registrierung analog `apps/server/src/index.ts:116`). Der bestehende
  `/internal`-Endpunkt wird über `DIGEST_RUN_TOKEN` gesichert
  (`packages/env/src/server.ts:71`) — digest-spezifischer Name. **Keinen
  zweiten Token erfinden:** entweder mitbenutzen oder auf einen allgemeinen
  `INTERNAL_RUN_TOKEN` umstellen (mit `DIGEST_RUN_TOKEN` als Alias, sonst
  brechen bestehende Deployments). T01 braucht denselben Token — abstimmen,
  wer die Umbenennung macht,
- Arbeit in der Datenbank claimen, `running`-Flag gegen überlappende Ticks,
- **in Batches** löschen mit Obergrenze pro Lauf — ein `DELETE` über Millionen
  Audit-Zeilen legt sonst die Datenbank lahm,
- jeder Lauf loggt strukturiert, was er gelöscht hat (Anzahl je Kategorie).

Die Löschsperre wird **im Runner** geprüft, nicht in der UI.

### Phase 2 — Löschsperre (Legal Hold)

Eine Sperre ist eine Aussage über ein Objekt: „dies darf nicht verschwinden,
egal welche Frist gilt".

- Tabelle `legal_hold`: `id`, `organizationId`, `subject` (`space` | `page` |
  `organization`), `subjectId`, `reason`, `createdBy`, `releasedAt`,
  `releasedBy`, `timestamps`.
- Wirkung — und hier liegt die eigentliche Arbeit:
  - Der Retention-Purge überspringt betroffene Zeilen (auch Audit-Zeilen, die
    auf eine gesperrte Seite/Space zeigen).
  - Der Papierkorb-Ablauf überspringt sie.
  - **Auch die manuelle Löschung** durch einen Benutzer wird abgelehnt. Eine
    Sperre, die nur automatische Prozesse aufhält, ist keine Sperre.
  - Eine Sperre auf einem Space wirkt auf dessen Seiten, Kommentare, Anhänge
    und Audit-Zeilen — die Vererbung muss explizit implementiert und getestet
    sein, nicht angenommen.
- Setzen und Aufheben werden auditiert. Aufheben ist ein eigenes Ereignis mit
  Begründung.
- UI: Sperre setzen/aufheben in den Space-Einstellungen und am Seiten-Header;
  gesperrte Objekte sind sichtbar markiert, damit niemand rätselt, warum
  „Löschen" nicht geht.

### Phase 3 — Papierkorb

- `page.deletedAt` einführen (zusätzlich zu `archivedAt` — **die beiden sind
  nicht dasselbe** und dürfen nicht zusammengelegt werden: archiviert heißt
  „nicht mehr aktuell, bleibt auffindbar", gelöscht heißt „weg, aber
  rückholbar bis zum Ablauf"). Dasselbe für `space`.
- Die bestehenden harten Löschpfade in `packages/api/src/routers/page.ts` und
  `space.ts` auf Soft-Delete umstellen. Prüfe dabei alle Leser: `page.list`
  (`routers/page.ts:374`), Suche (`routers/search.ts`), Backlinks,
  Favoriten, Abonnements, Export, Digest-Sammlung
  (`packages/api/src/lib/notifications/collect.ts`) müssen gelöschte Objekte
  ausblenden. Das ist der fehleranfälligste Teil des Tickets.
- Papierkorb-Ansicht pro Space: was liegt drin, wann läuft es ab, wer hat
  gelöscht. Wiederherstellen und sofort-endgültig-löschen.
- **Restore-Lücken aus `TODO.md` mitschließen:** UI für `pages.restore`, und
  Spaces müssen sich wiederherstellen lassen. Die UI verspricht das heute schon.
- Anhänge: Läuft eine Seite aus dem Papierkorb ab, müssen die Objekte im
  S3-Store mit weg (`packages/api/src/lib/storage.ts`,
  `packages/api/src/lib/attachments.ts`). Sonst wächst der Bucket ewig.

### Phase 4 — UI für die Fristen

Settings-Seite für Org-Admins, Aufbau analog zu
`apps/web/src/components/settings/digest-form.tsx`. Ein Verkürzen der Frist
löscht Daten — das braucht eine Bestätigung, die zeigt, wie viel beim nächsten
Lauf betroffen wäre.

## Nicht im Scope

- eDiscovery-Suche und Export über Sperren hinweg.
- Rechtstexte / DSGVO-Dokumentation (steht separat in `TODO.md`).
- Aufbewahrung für Backups (gehört zum Backup-Thema in `TODO.md`).
- Verschlüsselung, unveränderliche Ablage (WORM).

## Offene Entscheidungen — mit dem Menschen klären, nicht raten

1. **Darf das Audit-Log überhaupt gelöscht werden?** Es ist bewusst append-only
   (`packages/db/src/schema/wiki/activity.ts:10`). Aufbewahrungsfristen sind
   für Datenschutz nötig, untergraben aber die Nachweisbarkeit. Vorschlag:
   Default „unbegrenzt", Verkürzung ist eine bewusste Admin-Entscheidung, und
   das Setzen der Frist wird selbst auditiert — mit einem Eintrag, den die
   Frist nicht löscht.
2. **Wer darf eine Löschsperre aufheben?** Wenn derselbe Org-Admin sie setzen
   und aufheben kann, ist sie gegen genau die Person wirkungslos, gegen die
   sie meistens gerichtet ist. Braucht es eine Instanz-Admin-Rolle dafür
   (siehe T03)?

## Akzeptanzkriterien

`packages/api/tests/integration/retention.test.ts`:

- Frist `null` löscht nichts.
- Audit-Zeilen älter als die Frist werden gelöscht, jüngere nicht.
- Der Runner respektiert seine Batch-Obergrenze.
- Zwei parallele Läufe löschen nicht doppelt / kollidieren nicht.

`packages/api/tests/integration/legal-hold.test.ts`:

- Gesperrte Seite: Purge überspringt sie, Papierkorb-Ablauf überspringt sie,
  **und** die manuelle Löschung wird abgelehnt.
- Sperre auf einem Space schützt dessen Seiten und deren Audit-Zeilen.
- Nach `releasedAt` greifen die Fristen wieder.
- Sperre einer Org wirkt nicht auf eine andere.

`packages/api/tests/integration/trash.test.ts`:

- Gelöschte Seite verschwindet aus `pages.list`, Suche, Backlinks, Favoriten
  und Digest-Sammlung — je ein Test.
- Wiederherstellen bringt sie in allen genannten Sichten zurück.
- Ablauf löscht Zeile **und** zugehörige S3-Objekte.
- Ein archivierter Datensatz ist nicht dasselbe wie ein gelöschter (beide
  Zustände koexistieren korrekt).

## Migrations-Koordination

Dieses Ticket ändert Schema **und** `enums.ts` (neue `activityAction`-Werte für
Hold/Purge/Trash). Siehe `tickets/README.md`: Schema-Commit zuletzt, vor
`pnpm db:generate` rebasen. Falls T02 parallel läuft, vor Phase 1 kurz
abstimmen, wer `organization_setting` anlegt.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
Dokumentation: Fristen, Papierkorb und Sperren in `apps/docs/content/docs/`;
der Betreiber-Teil (welche Daten wie lange leben) auch in `DEPLOY.md`.
