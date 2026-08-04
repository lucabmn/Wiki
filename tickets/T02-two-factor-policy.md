# T02 — 2FA organisationsweit erzwingbar

**Ziel:** Ein Org-Admin kann Zwei-Faktor-Authentifizierung zur Pflicht machen.
Ohne das fällt das Projekt durch jede Beschaffungs-Checkliste.

## Ist-Zustand

- `packages/auth/src/index.ts:146` — `twoFactor()` ist ohne Konfiguration
  aktiviert. Reines Opt-in pro Benutzer.
- `packages/auth/src/index.ts:147` — `passkey()` ebenfalls aktiv.
- `packages/db/src/schema/auth.ts` — `user.twoFactorEnabled`, Tabellen
  `twoFactor` und `passkey` existieren.
- `apps/web/src/routes/_auth/settings/security.tsx` — Selbstverwaltung durch
  den Benutzer.
- `apps/web/src/routes/auth/two-factor.tsx` — Challenge-Seite beim Login.

Es gibt keinerlei org-weite Richtlinie und keinen Durchsetzungspunkt.

## Scope

### 1. Richtlinienspeicher

Das Projekt hat ein Muster für org-skalierte Einstellungen mit
Benutzer-Override: `packages/db/src/schema/wiki/notifications.ts`
(`organizationDigestSetting` / `userDigestSetting`, „keine Zeile = erben").
Hier braucht es nur die Org-Seite.

Lege eine allgemeine `organization_setting`-Tabelle an, **nicht** eine
`organization_two_factor_setting` — die nächsten Richtlinien (Session-Dauer,
Passwortregeln, erlaubte E-Mail-Domains aus `TODO.md`) kommen bestimmt, und
eine Tabelle pro Richtlinie wird unhandlich.

Spalten mindestens: `organizationId` (PK, FK auf `organization`, cascade),
`twoFactorRequired` (bool, default false), `twoFactorGraceUntil` (nullable
timestamp), `timestamps`.

### 2. Durchsetzung

Der entscheidende Punkt: Die Richtlinie muss **serverseitig am
Session-/Request-Pfad** greifen, nicht nur in der UI. Ein Benutzer ohne
zweiten Faktor in einer Org mit Pflicht darf keine Daten lesen.

Vorgeschlagener Ort: eine Middleware in der oRPC-Kette (siehe
`packages/api/src/index.ts`, wo `protectedProcedure` definiert wird), die nach
der Session-Prüfung die Richtlinie der aktiven Organisation lädt und bei
Verstoß einen typisierten Fehler wirft (z. B. `FORBIDDEN` mit
`code: "TWO_FACTOR_REQUIRED"`), den der Web-Client auf einen
Einrichtungs-Screen umleitet.

Ausnehmen musst du dabei zwingend:

- die 2FA-Einrichtung selbst (sonst ist der Benutzer ausgesperrt),
- Logout,
- `/api/auth/*` (läuft ohnehin an oRPC vorbei, siehe
  `apps/server/src/index.ts:105`),
- `/health`.

Die Richtlinie darf nicht bei jedem Request eine Query kosten — Better Auth
cached die Session 5 Minuten (`packages/auth/src/index.ts:37-40`); prüf, ob
sich der Richtlinien-Status analog cachen lässt, ohne dass eine Aktivierung
5 Minuten lang wirkungslos bleibt.

### 3. Grace Period

Eine Aktivierung, die alle Bestandsbenutzer sofort aussperrt, ist in der Praxis
unbenutzbar. Beim Einschalten setzt der Admin eine Frist (`twoFactorGraceUntil`);
bis dahin sieht ein Benutzer ohne zweiten Faktor ein Banner mit Countdown, danach
greift die harte Sperre. Beim Setzen der Richtlinie eine E-Mail an alle
betroffenen Mitglieder (Muster: `actionMail` in `packages/auth/src/mail.ts`).

### 4. UI

- Settings-Seite für Admins (eigene Seite oder Abschnitt in
  `apps/web/src/routes/_auth/settings/organization.tsx`): Schalter, Frist,
  und eine Liste bzw. Zählung der Mitglieder ohne zweiten Faktor. Ohne die
  Zählung schaltet niemand das Feature ein.
- Banner + Blockier-Screen für betroffene Benutzer, der auf
  `/settings/security` führt.

### 5. Audit

Aktivierung, Deaktivierung und Friständerung werden auditiert.

## Nicht im Scope

- Instanzweite (nicht org-weite) Erzwingung — gehört zu T03.
- Neue zweite Faktoren (SMS, E-Mail-OTP).
- Recovery-Code-Flows über das hinaus, was `twoFactor()` mitbringt.

## Offene Entscheidungen — mit dem Menschen klären, nicht raten

Beide ändern das Verhalten grundlegend und dürfen nicht implizit entschieden
werden:

1. **SSO-Benutzer:** Wer sich über einen SSO-Provider anmeldet
   (`packages/auth/src/index.ts`, `sso()`-Plugin), hat den zweiten Faktor
   typischerweise schon beim IdP. Sie zusätzlich zu lokalem TOTP zu zwingen,
   ist doppelt gemoppelt und in der Praxis ein Grund, das Feature nicht
   einzuschalten. Vorschlag: SSO-Konten sind standardmäßig ausgenommen, mit
   einem eigenen Schalter „auch für SSO erzwingen".
2. **Passkey:** Erfüllt ein registrierter Passkey die Anforderung? Fachlich ja
   (phishing-resistenter als TOTP). Wenn ja, muss die Prüfung „hat zweiten
   Faktor" `user.twoFactorEnabled` **oder** einen vorhandenen Passkey
   akzeptieren — nicht nur ersteres.

## Akzeptanzkriterien

`packages/api/tests/integration/two-factor-policy.test.ts`:

- Org mit `twoFactorRequired = false`: unveränderes Verhalten.
- Org mit Pflicht, Benutzer ohne zweiten Faktor, Frist abgelaufen: jede
  geschützte Prozedur antwortet mit `TWO_FACTOR_REQUIRED`.
- Derselbe Benutzer erreicht die 2FA-Einrichtung und den Logout weiterhin.
- Benutzer mit TOTP: unverändert. Benutzer nur mit Passkey: verhält sich gemäß
  der oben getroffenen Entscheidung (Test spiegelt die Entscheidung).
- Frist in der Zukunft: Zugriff erlaubt, Warnhinweis im Response/Session-State.
- Nicht-Admin kann die Richtlinie nicht ändern.
- Die Richtlinie einer Organisation wirkt nicht auf eine andere.

## Migrations-Koordination

Dieses Ticket legt eine Tabelle an. Siehe `tickets/README.md`: Schema-Commit
zuletzt, vor `pnpm db:generate` rebasen.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
