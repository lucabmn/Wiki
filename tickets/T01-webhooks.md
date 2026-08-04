# T01 — Webhooks / Event-Bus

**Ziel:** Ereignisse verlassen erstmals das System, damit Slack, Teams, Jira oder
eigene Automatisierungen daran hängen können.

## Ist-Zustand

Jede Mutation schreibt bereits eine Audit-Zeile — der Seam existiert also schon:

- `packages/api/src/lib/activity.ts` — `recordActivity(db, {...})`, nimmt die
  Transaktion des Aufrufers entgegen (`ActivityExecutor`), schreibt in
  `wiki.activity`.
- `packages/db/src/schema/wiki/activity.ts` — append-only, `organizationId`,
  `spaceId`, `pageId`, `actorId`, `action`, `metadata`.
- `packages/db/src/schema/wiki/enums.ts` — `activityAction` listet die 16
  heutigen Aktionen.

Nichts davon verlässt die Datenbank. Es gibt keine Webhook-Konfiguration, keinen
Zustellmechanismus, keine Signatur.

**Vererbte Lücke, die du nicht schließen musst, aber dokumentieren:** `TODO.md`
räumt ein, dass die Audit-Abdeckung ACL- und Membership-Änderungen sowie
Comment-Edits nicht erfasst. Webhooks auf Basis von `recordActivity` erben
diese Lücke. Schreib in die Doku, welche Events es gibt — nicht „alle".

## Scope

### 1. Outbox statt Direktzustellung

Der HTTP-Versand darf **nicht** in der Mutations-Transaktion passieren: ein
langsamer oder toter Empfänger würde sonst die Schreiboperation blockieren, und
ein Rollback nach erfolgtem POST hätte ein Event für etwas ausgeliefert, das nie
stattgefunden hat.

Stattdessen: `recordActivity` schreibt zusätzlich eine Zeile in eine
`webhook_delivery`-Tabelle (in derselben Transaktion, also atomar mit dem
Audit-Eintrag). Ein Runner drainiert sie nach dem Commit.

Neue Tabellen in `packages/db/src/schema/wiki/webhooks.ts`:

- `webhook` — `id`, `organizationId`, `url`, `secret`, `events` (Array aus
  `activityAction`), `spaceId` (nullable = alle Spaces), `active`, `createdBy`,
  `timestamps`. URL-Validierung: nur `http(s)`, wiederverwendbar aus
  `packages/api/src/lib/external-url.ts`.
- `webhook_delivery` — `id`, `webhookId`, `activityId`, `status`
  (`pending` / `delivered` / `failed`), `attempts`, `nextAttemptAt`,
  `lastError`, `responseStatus`, `deliveredAt`, `timestamps`.
  Index auf `(status, nextAttemptAt)` — darauf claimt der Runner.

### 2. Runner

Kopiere das Muster aus `apps/server/src/digests.ts` **exakt**, es löst genau
dieses Problem schon einmal:

- In-Process-Ticker für den langlebigen Container.
- `POST /internal/webhooks/run` für Deployments ohne langlebigen Prozess
  (Registrierung analog `apps/server/src/index.ts:116`).

  **Achtung beim Shared Secret:** Der bestehende `/internal`-Endpunkt wird über
  `DIGEST_RUN_TOKEN` gesichert (`packages/env/src/server.ts:71`) — der Name ist
  digest-spezifisch. Erfinde **keinen** zweiten Token. Entweder
  `DIGEST_RUN_TOKEN` mitbenutzen, oder auf einen allgemeinen
  `INTERNAL_RUN_TOKEN` umstellen und `DIGEST_RUN_TOKEN` als Alias
  weiterunterstützen (bestehende Deployments dürfen nicht brechen). T04 braucht
  denselben Token — abstimmen, wer die Umbenennung macht.

- Arbeit wird **in der Datenbank geclaimt**, damit beide Trigger gleichzeitig
  aktiv sein dürfen, ohne doppelt zuzustellen.
- Ein laufender Batch blockiert den nächsten Tick (`running`-Flag), statt sich
  aufzustauen.

Zustellung: `POST` mit JSON-Body, Header `X-Wiki-Signature` =
`sha256=<HMAC(secret, timestamp + "." + body)>` und `X-Wiki-Timestamp`
(Replay-Schutz, Empfänger kann alte Requests verwerfen). Retry mit
exponentiellem Backoff, harte Obergrenze an Versuchen, danach `failed`.
Timeout pro Request setzen — ein hängender Empfänger darf den Batch nicht
blockieren.

### 3. API + UI

- Neuer Router `packages/api/src/routers/webhook.ts`, registriert in
  `packages/api/src/routers/index.ts`. Alle Prozeduren verlangen
  Org-Admin-Rechte (`requireOrgPermission`, Muster in
  `packages/api/src/routers/notification.ts:56`).
- `list`, `create`, `update`, `delete`, `test` (einmaliger Ping-Versand),
  `listDeliveries` (letzte N Zustellungen inkl. Fehler — ohne die ist das
  Feature nicht debugbar).
- Das Secret wird bei `create` **einmal** im Klartext zurückgegeben und danach
  nie wieder; `list` liefert nur ein Präfix.
- Settings-Seite `apps/web/src/routes/_auth/settings/webhooks.tsx`, Aufbau
  analog zu `apps/web/src/routes/_auth/settings/sso.tsx`. Zustellhistorie mit
  Statuscode und Fehlertext sichtbar machen.

### 4. Audit

Webhook-Anlage/-Änderung/-Löschung sind selbst auditierbare Ereignisse. Ergänze
`activityAction` um `webhook.created`, `webhook.updated`, `webhook.deleted`.
Achte darauf, dass diese Aktionen den Webhook-Versand nicht rekursiv auslösen.

## Nicht im Scope

- Vervollständigung der Audit-Abdeckung (ACL, Membership) — eigenes Vorhaben.
- Eingehende Webhooks, Slack-App, fertige Integrationen.
- Ein UI für Event-Filter jenseits einer Checkbox-Liste der `activityAction`.
- Payload-Templating.

## Offene Entscheidungen — mit dem Menschen klären, nicht raten

1. **Payload-Form:** schlanker Envelope (`{event, orgId, spaceId, pageId, actorId,
at, metadata}`) oder die vollständige Ressource mitliefern? Schlank ist
   billiger und leakt nichts, was der Empfänger nicht sehen darf — aber jeder
   Empfänger braucht dann einen API-Key zum Nachladen, und **API-Keys gibt es
   heute nicht** (`packages/api/src/context.ts` kennt nur Session-Cookies).
   Das spricht für einen etwas dickeren Payload.
2. **SSRF:** darf ein Org-Admin einen Webhook auf `http://localhost:5432` oder
   eine Cloud-Metadata-IP zeigen lassen? Auf einer Multi-Tenant-Instanz ist das
   eine Rechteausweitung. Braucht es eine Allow-/Blocklist per Env?

## Akzeptanzkriterien

`packages/api/tests/integration/webhook.test.ts`:

- Nicht-Admin bekommt `FORBIDDEN` auf jede Prozedur.
- `create` gibt das Secret zurück, `list` nur das Präfix.
- Webhook einer anderen Organisation ist weder les- noch änderbar (Tenant-Isolation).
- Eine Mutation, die `recordActivity` auslöst, erzeugt genau eine
  `webhook_delivery`-Zeile pro passendem, aktivem Webhook — und keine für
  Webhooks, die dieses Event nicht abonniert haben.
- Ein zurückgerollter Transaktionsblock hinterlässt **keine** Delivery-Zeile.

Runner-Tests (`apps/server/tests/`):

- Zwei parallele Runs stellen nicht doppelt zu (Claim greift).
- Ein 500er markiert `failed`+Retry, kein Datenverlust.
- Die Signatur ist über `timestamp + "." + body` berechnet und verifizierbar.

## Migrations-Koordination

Dieses Ticket ändert Schema **und** `enums.ts`. Siehe `tickets/README.md`:
Schema-Commit zuletzt, vor `pnpm db:generate` rebasen.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
Dokumentation: Event-Liste, Payload-Form und Signaturprüfung in
`apps/docs/content/docs/`.
