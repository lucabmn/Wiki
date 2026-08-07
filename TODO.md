P1 – Für echte Production Readiness

### ~~Backup und Recovery~~ — erledigt

Ein Backup-Lauf erzeugt jetzt **ein Recovery-Set**: Datenbank-Dump _und_ alle
Attachment-Bytes unter einem Zeitstempel, mit SHA-256-Prüfsummen über beides.

- Attachments werden über die S3-API gespiegelt — es muss nichts gestoppt werden.
- Offsite-Kopie (`BACKUP_REMOTE_*`), bewusst `mc cp` statt `mc mirror`, damit
  lokales Pruning nicht auf die Fernkopie durchschlägt.
- Optionale Verschlüsselung at rest (`BACKUP_PASSPHRASE`).
- Backup-Alter treibt den Container-Healthcheck: ein still gescheitertes Backup
  ist in `docker compose ps` sichtbar, nicht erst beim Restore.
- Restore ist ein Kommando, prüft Prüfsummen _vor_ dem Schreiben und verweigert
  eine bereits befüllte Datenbank. CI fährt Backup **und Restore** bei jeder
  Änderung (`.github/workflows/smoke.yml`).
- RPO/RTO und eine quartalsweise Restore-Übung stehen in `DEPLOY.md`.

### ~~Registrierung kontrollierbar machen~~ — erledigt

`SIGNUP_MODE=open|invite|closed`, optionale Domain-Allowlist
(`SIGNUP_ALLOWED_EMAIL_DOMAINS`) und optional verpflichtende E-Mail-Verifikation
(`REQUIRE_EMAIL_VERIFICATION`). Durchgesetzt in der Auth-Schicht auf
`/sign-up/email` — SSO und SCIM bleiben absichtlich unberührt, `INITIAL_ADMIN_EMAIL`
ist in jedem Modus ausgenommen. Siehe `DEPLOY.md` → „Who may register“.

### Observability

**Erledigt:** Healthchecks decken jetzt jede Abhängigkeit ab.
`/health/live` (nichts), `/health` (Datenbank — was der Orchestrator beobachtet)
und `/health/ready` (Datenbank, Object Storage, Collab, Mail, je Komponente
gemeldet). Backup-Alter ist ein Container-Health-Signal. `DEPLOY.md` nennt einen
minimalen Alerting-Regelsatz.

**Offen:** ein echtes Metrics-Backend (Prometheus-Endpunkt o. Ä.), SLOs,
Disk-/DB-Pool-Monitoring und Incident-Runbooks über die Restore-Übung hinaus.
Für einen Single-Host-Betrieb ist Container-Health plus `/health/ready` die
Grundlage; ein `/metrics`-Endpunkt wäre der nächste sinnvolle Schritt.

### ~~Security Headers~~ — erledigt

HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Cross-Origin-Opener-Policy` und eine `Permissions-Policy`, die nichts gewährt —
in einem Snippet, das jeder Host importiert. `'unsafe-inline'` für script/style
ist bewusst gesetzt und im `Caddyfile` begründet (SSR-Hydration, Editor,
Mermaid); eine Nonce-basierte Policy bräuchte Umbauten an beiden.

### ~~Deployment-E2E-Tests~~ — teilweise erledigt

`.github/workflows/smoke.yml` fährt den echten Compose-Stack hoch und testet
über HTTP: Health (alle drei Routen), Registrierung, Organisation, Space,
Seitenbearbeitung, Seitenbaum, Attachment-Roundtrip, WebSocket-Collaboration,
Audit-Log, Rate Limiting — dann Backup, Datenbank zerstören, Restore, und die
Prüfung, dass Seiten _und Attachments_ zurück sind.

**Offen:** Playwright/Cypress im Browser und automatisierte
Accessibility-Prüfung (axe). Der Smoke-Test deckt die API-Ebene ab, nicht das
gerenderte UI.

────────────────────────────────────────────────────────────────────────────────

P1 – Produktreife eines Wikis

### ~~Skalierbare Seitennavigation~~ — erledigt

`pages.tree` liefert acht Spalten statt jeder Seite samt Dokumentkörper.
Sidebar und Breadcrumb nutzen ihn; derselbe ACL-Filter wie `pages.list`, mit
einem Test, der das festhält.

### ~~Archiv-Wiederherstellung vollständig machen~~ — erledigt

Geschlossen mit dem Datenlebenszyklus (`tickets/T04-data-lifecycle.md`):

- `spaces.restore` hebt die Archivierung auf; die Aktion sitzt in den
  Space-Einstellungen, erreichbar über den Filter „Archiviert" in der
  Space-Übersicht.
- Der Seiten-Kopf zeigt für eine archivierte Seite „Wiederherstellen" statt
  „Archivieren" — die vorhandene `pages.restore`-API hat damit eine UI.
- Zusätzlich gibt es jetzt einen Papierkorb: Löschen ist ein Soft-Delete mit
  Frist, Wiederherstellen und endgültiges Löschen sind eigene Aktionen. Siehe
  `apps/docs/content/docs/concepts/data-lifecycle.mdx`.

### ~~Audit Log ehrlich vervollständigen~~ — erledigt

ACL-Änderungen (Space- und Seiten-Mitgliedschaften, Rollenwechsel, Entzug),
Seiten-Sichtbarkeit und Comment-Edits schreiben jetzt Audit-Zeilen — innerhalb
der Transaktion der Mutation, damit ein zurückgerollter Vorgang nie im Log
steht. Die Metadaten denormalisieren, _wessen_ Zugriff sich geändert hat, weil
die Mitgliedszeile beim Lesen des Logs längst weg ist.

Die README-Behauptung ist auf das eingeschränkt, was tatsächlich gilt, und
verweist auf das Enum statt es zu wiederholen.

### Subscriptions tatsächlich benachrichtigen

Teilweise erledigt: Gebündelte Benachrichtigungen (Digests) verschicken periodische Zusammenfassungen per E-Mail, wahlweise mit Umfang „Nur abonnierte Seiten“ — Abonnements und Favoriten lösen damit erstmals einen Versand aus. Admins setzen Vorgaben für die Organisation, Benutzer können sie für sich überschreiben.

Offen bleibt:

- Sofortbenachrichtigung bei einzelnen Ereignissen (heute nur periodisch gebündelt),
- In-App-Benachrichtigungen bzw. ein Posteingang (es gibt bisher nur E-Mail),
- gezielte Benachrichtigung bei @-Erwähnungen und Antworten auf eigene Kommentare.

### Accessibility

**Erledigt:** Page-Reordering geht jetzt auch ohne Zeigegerät — vier diskrete
Züge (hoch, runter, ein-, ausrücken), sowohl als `Alt`+Pfeil auf der fokussierten
Zeile als auch als Menü pro Zeile, mit einer `aria-live`-Ansage. Unmögliche Züge
sind deaktiviert statt still wirkungslos.

**Offen:** axe-basierte Prüfung und Tastatur-E2E über den Seitenbaum hinaus.

────────────────────────────────────────────────────────────────────────────────

P1 – Open Source Readiness

### ~~Community-Dateien ergänzen~~ — erledigt

`CODE_OF_CONDUCT.md`, `SUPPORT.md`, `GOVERNANCE.md`, `MAINTAINERS.md`,
`.github/CODEOWNERS`, `CHANGELOG.md`. `GOVERNANCE.md` benennt die fünf öffentlichen
Verträge (REST-Oberfläche, Exportformat, Env-Variablen, Schema, Compose-Service-
und Volume-Namen) samt Breaking-Change- und SemVer-Politik.

### ~~Contributor Setup reparieren~~ — erledigt

`CONTRIBUTING.md` nennt jetzt `apps/collab/.env` und hebt hervor, dass
`BETTER_AUTH_SECRET` in Server und Collab identisch sein muss — sonst verbindet
sich der Editor und scheitert danach still an der Authentifizierung.

### Release Supply Chain

**Erledigt:** SHA-256-Prüfsummen und signierte Build-Provenance für die
Installer-Binaries (im bauenden Job, nicht nachträglich), BuildKit-Provenance
(`mode=max`) und SPDX-SBOM am Image-Manifest, plus ein Quell-SBOM am Release.
`DEPLOY.md` → „Verifying a release“ dokumentiert die Prüfung und das Pinnen per
Digest. Workflow-Rechte sind least-privilege pro Job.

**Offen:** Actions auf Commit-SHAs pinnen. Bewusst nicht blind gemacht — ein
nicht verifizierter Digest wäre schlechter als kein Pin. Der
`github-actions`-Eintrag in `dependabot.yml` hält die Pins danach aktuell.
Optional zusätzlich Cosign-/Sigstore-Signaturen.

### ~~Dependency Automation~~ — erledigt

Dependabot über Workspace, Actions und die vier Base-Images, gruppiert (Security
Updates ungruppiert, damit ein fremder CI-Fehler kein Advisory aufhält). CodeQL
wöchentlich über TypeScript _und_ die Workflows; Dependency Review als Gate für
neu eingeführte High-Severity-Advisories auf PRs.

### ~~Datenschutz und Datenlebenszyklus~~ — erledigt

`docs/privacy.md`: welche personenbezogenen Daten wo liegen, wohin sie die
Instanz verlassen können (Mail, Webhooks, Offsite-Backups — alle drei vom
Betreiber konfiguriert), Auskunft/Berichtigung/Löschung, Organisationslöschung,
Export, Telemetrieverhalten (keines) und die Verantwortlichkeiten des
Self-Hosters. Inklusive der ehrlichen Aussage, dass Aufbewahrungsfristen
bewusst **nicht** in Backups greifen.

────────────────────────────────────────────────────────────────────────────────

P2 – Danach sinnvoll

- ~~Read-only Filesystems, Capability Drops und Resource Limits~~ — Capability
  Drops, `no-new-privileges`, PID- und Memory-Limits sind gesetzt.
  Read-only-Rootfs bleibt offen: das braucht ein tmpfs je Schreibpfad und einen
  Rebuild zur Verifikation.
- ~~ATTACHMENT_MAX_MB tatsächlich durch Compose weiterreichen~~ — erledigt,
  zusammen mit den PDF-Export-Ceilings, den Rate Limits und `APP_NAME`.
- Container-Images per Digest pinnen (dokumentiert in `DEPLOY.md`, aber nicht
  Vorgabe der Compose-Datei)
- Changelog automatisch aus Releases/PRs generieren
- Performance-/Lasttests für große Spaces
- Storage- und DB-Kapazitätsrichtlinien
- klare Single-Host-Grenzen dokumentieren
- dokumentierte Upgrade-Kompatibilitätsmatrix
- `/metrics`-Endpunkt (Prometheus) als nächster Observability-Schritt

────────────────────────────────────────────────────────────────────────────────

Verbleibende Reihenfolge

1.  Actions auf Commit-SHAs pinnen (verifizierte Digests)
2.  Browser-E2E (Playwright) und axe-Accessibility-Prüfung
3.  Metrics/SLOs und Incident-Runbooks
4.  Sofort- und In-App-Benachrichtigungen
5.  Lasttests und Kapazitätsrichtlinien

Die normalen Qualitätsprüfungen sind weiterhin grün: Typecheck, Tests und Build
laufen erfolgreich, und der Deployment-Smoke-Test prüft zusätzlich den
zusammengesetzten Stack inklusive Restore.
