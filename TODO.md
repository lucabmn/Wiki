P1 – Für echte Production Readiness

### Backup und Recovery

Der vorhandene Backup-Service sichert nur PostgreSQL:

- Attachments fehlen.
- Backups bleiben standardmäßig auf demselben Host.
- Fehler machen den Container nicht unhealthy.
- Keine automatischen Restore-Tests.
- Keine definierten RPO/RTO.

Benötigt werden:

1.  konsistentes DB- und Object-Store-Backup,
2.  Offsite-Kopie,
3.  Checksums/Verschlüsselung,
4.  Backup-Alter als Health-/Monitoring-Signal,
5.  dokumentierter und regelmäßig getesteter Restore.

### Registrierung kontrollierbar machen

Öffentliche Registrierung ist aktiv, E-Mail-Verifikation aber nicht erforderlich. Für private Organisations-Wikis braucht es Konfiguration wie:

- SIGNUP_ENABLED=false
- Invitation-only
- optional verpflichtende E-Mail-Verifikation
- optional erlaubte E-Mail-Domains

### Observability

Strukturierte Logs und Healthchecks existieren, aber noch keine:

- Metrics,
- Alerting,
- SLOs,
- Backup-Alarme,
- Disk-/DB-Pool-/Storage-Monitoring,
- Incident-Runbooks.

/health prüft derzeit im Wesentlichen PostgreSQL. Object Storage und Collaboration können ausfallen, während der API-Container gesund erscheint.

### Security Headers

Im Caddyfile fehlen explizite Browser-Sicherheitsheader:

- HSTS
- CSP bzw. mindestens frame-ancestors
- Referrer-Policy
- Permissions-Policy
- X-Content-Type-Options

### Deployment-E2E-Tests

CI baut Images, startet aber den tatsächlichen Stack nicht. Sinnvoll wäre ein Smoke-Test mit:

1.  PostgreSQL und RustFS starten,
2.  Migrationen ausführen,
3.  Stack starten,
4.  Registrierung/Login,
5.  Seite erstellen und bearbeiten,
6.  WebSocket-Collaboration,
7.  Attachment Upload/Download,
8.  Backup und Restore.

Zusätzlich fehlen Playwright-/Cypress- und automatisierte Accessibility-Tests.

────────────────────────────────────────────────────────────────────────────────

P1 – Produktreife eines Wikis

### Skalierbare Seitennavigation

pages.list lädt für den Baum alle Seiten inklusive vollständigem Content:

- packages/api/src/routers/page.ts
- apps/web/src/components/page-tree/page-tree.tsx

Für große Wikis braucht es einen schlanken Tree-Endpunkt mit nur ID, Titel, Parent, Reihenfolge, Status und Slug.

### Archiv-Wiederherstellung vollständig machen

- Spaces können archiviert, aber offenbar nicht regulär wiederhergestellt werden.
- Für Seiten existiert eine Restore-API, aber keine passende UI.
- Die UI verspricht Wiederherstellung dennoch.

### Audit Log ehrlich vervollständigen

README behauptet, jede Mutation werde auditiert. Tatsächlich fehlen unter anderem:

- ACL-Änderungen,
- Membership-Änderungen,
- Comment-Edits,
- Teile der Auth-/Org-Mutationen.

Entweder Audit-Abdeckung vervollständigen oder die Produktbeschreibung einschränken.

### Subscriptions tatsächlich benachrichtigen

Teilweise erledigt: Gebündelte Benachrichtigungen (Digests) verschicken periodische Zusammenfassungen per E-Mail, wahlweise mit Umfang „Nur abonnierte Seiten“ — Abonnements und Favoriten lösen damit erstmals einen Versand aus. Admins setzen Vorgaben für die Organisation, Benutzer können sie für sich überschreiben.

Offen bleibt:

- Sofortbenachrichtigung bei einzelnen Ereignissen (heute nur periodisch gebündelt),
- In-App-Benachrichtigungen bzw. ein Posteingang (es gibt bisher nur E-Mail),
- gezielte Benachrichtigung bei @-Erwähnungen und Antworten auf eigene Kommentare.

### Accessibility

Page-Reordering funktioniert nur per Pointer. Es fehlen Keyboard-/Menü-Alternativen. Außerdem sollte mindestens axe-basierte Prüfung plus Tastatur-E2E eingeführt werden.

────────────────────────────────────────────────────────────────────────────────

P1 – Open Source Readiness

### Community-Dateien ergänzen

Mindestens:

- CODE_OF_CONDUCT.md
- SUPPORT.md
- GOVERNANCE.md oder MAINTAINERS.md
- .github/CODEOWNERS
- CHANGELOG.md
- Release-/SemVer- und Breaking-Change-Policy

### Contributor Setup reparieren

CONTRIBUTING.md vergisst die Konfiguration von apps/collab/.env, obwohl pnpm dev den Collab-Service startet.

### Release Supply Chain

Für Release-Artefakte fehlen:

- SHA-256 Checksums,
- SBOMs,
- Artifact Attestations/Provenance,
- optional Cosign-/Sigstore-Signaturen.

GitHub Actions sollten außerdem auf Commit-SHAs gepinnt und Schreibrechte nur den Publish-Jobs gegeben werden.

### Dependency Automation

Es fehlen Dependabot/Renovate und Dependency Review/CodeQL. Derzeit bestehen zwei moderate Advisories:

- esbuild
- @hono/node-server

Keine davon ist aktuell „high“, aber sie sollten geprüft und automatisiert verfolgt werden.

### Datenschutz und Datenlebenszyklus

Für Betreiber sollte dokumentiert werden:

- welche personenbezogenen Daten gespeichert werden,
- Log- und Audit-Retention,
- Account-/Org-Löschung,
- Datenexport,
- Backup-Löschung,
- Telemetrieverhalten,
- Verantwortlichkeiten des Self-Hosters.

────────────────────────────────────────────────────────────────────────────────

P2 – Danach sinnvoll

- Container-Images per Digest pinnen
- Read-only Filesystems, Capability Drops und Resource Limits
- ATTACHMENT_MAX_MB tatsächlich durch Compose weiterreichen
- Changelog automatisch aus Releases/PRs generieren
- Performance-/Lasttests für große Spaces
- Storage- und DB-Kapazitätsrichtlinien
- klare Single-Host-Grenzen dokumentieren
- dokumentierte Upgrade-Kompatibilitätsmatrix

Empfohlene Reihenfolge

1.  Lizenz und Repository-Links
2.  ACL-Leaks und tenantübergreifende Grants
3.  Attachment-Lifecycle
4.  Secret- und Auth-Link-Logging
5.  vollständige Backups plus Restore-Test
6.  Signup-/Produktionskonfiguration
7.  Deployment-E2E und Accessibility
8.  Export, Restore-UI und Skalierung
9.  Community-, Release- und Supply-Chain-Dateien

Die normalen Qualitätsprüfungen sind aktuell stark: Typecheck, Tests und Build laufen erfolgreich; die größte verbleibende Arbeit liegt nicht bei allgemeiner Codequalität, sondern bei Security-Randfällen,  
 Betriebssicherheit, Datenlebenszyklus und Open-Source-Governance.
