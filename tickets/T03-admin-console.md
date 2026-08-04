# T03 — Admin-Konsole & Impersonation

**Ziel:** Der Betreiber einer Instanz bekommt eine instanzweite Sicht und die
Support-Werkzeuge, die das bereits aktivierte Better-Auth-`admin()`-Plugin
liefert — inklusive auditierter Impersonation.

## Ist-Zustand

- `packages/auth/src/index.ts:145` — `admin()` ist **ohne Konfiguration**
  aktiviert. Alle Fähigkeiten des Plugins (Benutzer auflisten/anlegen, Rolle
  setzen, sperren, Sessions auflisten und widerrufen, Impersonation) sind
  serverseitig erreichbar.
- `packages/db/src/schema/auth.ts:14-30` — `user.role`, `user.banned`,
  `user.banReason`, `user.banExpires` existieren bereits.
- In `apps/web/src/routes` gibt es **keine** `/admin`-Route. Das Feature ist
  komplett unerreichbar.

**Wichtig, prüf das als Allererstes:** Auf einer frischen Instanz trägt kein
Benutzer die Admin-Rolle — `user.role` ist nullable und wird bei der
Registrierung nicht gesetzt. Eine Admin-Konsole, in die niemand hineinkommt,
ist wertlos. Kläre, wie der erste Admin entsteht, bevor du UI baust.

## Scope

### 1. Bootstrapping des ersten Admins

Wähle einen Weg und dokumentiere ihn in `DEPLOY.md`:

- Erster registrierter Benutzer der Instanz wird Instanz-Admin (bequem, aber
  ein Rennen, wenn die Instanz offen im Netz steht, bevor jemand registriert),
  **oder**
- eine Env-Variable (z. B. `INITIAL_ADMIN_EMAIL` in
  `packages/env/src/server.ts`), die beim Start die Rolle setzt (explizit,
  passt zum bestehenden installer-getriebenen Setup).

Der zweite Weg passt besser zum vorhandenen Installer. Zusätzlich muss ein
Instanz-Admin weitere Admins ernennen können.

**Abgrenzung, die im UI klar sein muss:** Instanz-Admin (`user.role`) ist etwas
anderes als Org-Admin (Better-Auth-Organization-Rolle, siehe
`docs/permissions.md`). Ein Instanz-Admin ist keine Org-Mitgliedschaft und darf
nicht stillschweigend Inhalte lesen — siehe offene Entscheidung 1.

### 2. Admin-Bereich im Web

Neue Routen unter `apps/web/src/routes/_auth/admin/`, nur für `user.role`
mit Admin-Berechtigung sichtbar und serverseitig gegated (nicht nur
Navigation ausblenden):

- **Benutzer** — Liste mit Suche/Pagination, Detailansicht: Organisationen,
  2FA-Status, Passkeys, letzte Anmeldung.
- **Aktionen** — Rolle setzen, sperren/entsperren (mit Grund und Ablauf,
  die Spalten existieren), Passwort-Reset auslösen, Benutzer löschen.
- **Sessions** — aktive Sessions eines Benutzers anzeigen und einzeln oder
  komplett widerrufen. Das ist zugleich die fehlende Hälfte der
  SCIM-Deprovisionierung: ein deaktiviertes Konto muss man aus laufenden
  Sessions werfen können.
- **Organisationen** — Liste mit Mitgliederzahl, Space-Zahl, Speicherverbrauch;
  Detailansicht.
- **Instanz-Übersicht** — Version, Anzahl Benutzer/Orgs/Spaces/Seiten,
  Storage-Backend, SMTP konfiguriert ja/nein, Collab erreichbar ja/nein.
  Das ist die Seite, die bei einem Support-Fall zuerst aufgerufen wird.

### 3. Impersonation

Über `admin()` verfügbar. Anforderungen, die über den reinen Aufruf hinausgehen:

- **Ständig sichtbares Banner** in der gesamten App, solange impersoniert wird,
  mit Ein-Klick-Ausstieg. Ohne das verliert der Admin den Überblick, in wessen
  Konto er schreibt.
- **Zeitlich begrenzt** — die impersonierte Session läuft von sich aus ab.
- **Beidseitig auditiert:** Start und Ende, mit echtem Akteur _und_ Ziel.
  Erscheint auch im Aktivitätsfeed des Ziels, nicht nur im Admin-Log.
- Schreibende Aktionen während der Impersonation tragen im Audit sowohl den
  impersonierten Benutzer als auch den echten Admin.

### 4. Audit-Ablage für Admin-Ereignisse

`wiki.activity` ist **org-skaliert** (`organizationId` ist `NOT NULL`,
`packages/db/src/schema/wiki/activity.ts:15-17`). Instanzweite Ereignisse —
Benutzer gesperrt, Rolle geändert, Impersonation gestartet — haben keine
Organisation und passen dort nicht hinein.

Entscheide und begründe im Code-Kommentar:

- eigene Tabelle `admin_audit` (sauber, aber zwei Audit-Quellen), **oder**
- `activity.organizationId` nullable machen (eine Quelle, aber eine Migration
  über eine große Tabelle und alle Leser müssen mit NULL umgehen).

Empfehlung: eigene Tabelle. Die Zugriffsregeln sind ohnehin andere — Org-Admins
dürfen Instanz-Ereignisse nicht sehen.

## Nicht im Scope

- Metriken, Alerting, SLOs (steht als eigener Punkt in `TODO.md`).
- Lizenz-/Abrechnungsverwaltung.
- Konfigurationsänderungen zur Laufzeit (Env bleibt Env).
- Die org-weite 2FA-Richtlinie — das ist T02.

## Offene Entscheidungen — mit dem Menschen klären, nicht raten

1. **Darf ein Instanz-Admin Wiki-Inhalte lesen?** Technisch kann er es sich über
   Impersonation immer verschaffen. Die Frage ist, ob die Admin-Konsole selbst
   Inhalte zeigt. Vorschlag: **nein** — Metadaten ja, Seiteninhalte nein; wer
   Inhalte braucht, impersoniert, und genau das steht dann im Audit. Das ist
   der Unterschied zwischen „Admin liest mit" und „Admin hat mitgelesen und es
   ist nachweisbar".
2. **Impersonation abschaltbar?** Manche Betreiber wollen sie per Env hart
   deaktivieren können.

## Akzeptanzkriterien

`packages/api/tests/integration/admin.test.ts` bzw. `packages/auth/tests/`:

- Benutzer ohne Admin-Rolle bekommt auf jede Admin-Prozedur `FORBIDDEN` —
  auch wenn er Org-Owner ist.
- Sperren beendet die Sessions des Benutzers; ein bestehendes Session-Cookie
  gilt danach nicht mehr (Session-Cache läuft nicht 5 Minuten nach).
- Impersonation erzeugt genau zwei Audit-Einträge (Start und Ende) mit echtem
  Akteur und Ziel.
- Eine Seitenbearbeitung während Impersonation trägt beide Identitäten.
- Die impersonierte Session läuft nach der konfigurierten Zeit ab.
- Session-Widerruf durch den Admin wirkt sofort.

`apps/web/tests/`:

- Das Impersonation-Banner ist gerendert, solange die Session impersoniert ist.
- Die Admin-Navigation ist für Nicht-Admins nicht erreichbar — und der
  direkte Routenaufruf ebenso wenig.

## Migrations-Koordination

Dieses Ticket legt vermutlich eine Tabelle an und erweitert eventuell
`activityAction`. Siehe `tickets/README.md`: Schema-Commit zuletzt, vor
`pnpm db:generate` rebasen.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
Dokumentation: Bootstrapping des ersten Admins in `DEPLOY.md`, Abgrenzung
Instanz-Admin vs. Org-Rolle in `docs/permissions.md`.
