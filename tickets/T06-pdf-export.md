# T06 — PDF-Export

**Ziel:** Seiten und Spaces lassen sich als PDF exportieren. Das ist das Format,
nach dem in Organisationen tatsächlich gefragt wird — Markdown/HTML/JSON deckt
Migration ab, nicht „schick das mal der Rechtsabteilung".

## Ist-Zustand

- `apps/server/src/space-exports.ts:30` — `const FORMATS = new Set<ExportFormat>(
["markdown", "html", "json"])`, Route `GET /exports/spaces/:id?format=…`,
  streamt ein ZIP über `archiver`.
- `apps/server/src/space-export-format.ts` — `documentToHtml`,
  `documentToMarkdown`, `normalizeDocument`, `rewriteDocumentUrls`,
  `contentFileName`, `safeArchiveName`. **`documentToHtml` ist der Ansatzpunkt**
  — PDF entsteht aus dem bereits vorhandenen HTML, nicht aus einem zweiten
  Renderer.
- `apps/web/src/lib/space-export.ts` — Client-Seite.
- `docs/export-format.md` — dokumentiert das Archivformat.
- Autorisierung über `requireSpaceCapability`, siehe
  `apps/server/src/space-exports.ts:33-45`.

Es gibt keinen Einzelseiten-Export in irgendeinem Format.

## Scope

### 1. Renderer-Entscheidung — vorab treffen, siehe unten

Der Rest des Tickets hängt daran. Nicht anfangen, bevor sie steht.

### 2. `pdf` als Exportformat

- `FORMATS` erweitern, `ExportFormat`-Typ erweitern, `contentFileName` um die
  Endung ergänzen.
- Ein PDF pro Seite im ZIP, mit derselben Verzeichnisstruktur, die
  Markdown/HTML schon benutzen — die Hierarchie bleibt so erhalten.
- **Interne Links:** `rewriteDocumentUrls` schreibt Links heute auf relative
  Dateipfade um. Für PDF müssen sie entweder auf die entsprechende PDF-Datei
  zeigen oder auf die Live-URL. Entscheide und dokumentiere es.
- **Bilder/Anhänge:** müssen im PDF eingebettet sein, nicht referenziert. Ein
  PDF, dessen Bilder auf einen nicht öffentlichen S3-Bucket zeigen, ist leer.
- **Ressourcenschutz:** Ein Space mit 5000 Seiten darf den Server nicht
  umbringen. Seiten seriell rendern, Timeout pro Seite, Obergrenze konfigurierbar
  — und wenn die Grenze greift, muss das im Ergebnis sichtbar sein (Datei im
  ZIP oder Fehler), nicht stillschweigend abgeschnitten.

### 3. Einzelseiten-Export

Neue Route `GET /exports/pages/:id?format=pdf`, gegated über
`requirePageCapability` (`packages/api/src/lib/authz.ts`) statt über den Space.
Direktes PDF, kein ZIP. Aktion im Seitenmenü.

Wenn der Aufwand es hergibt, dabei auch Markdown/HTML für Einzelseiten
freischalten — es ist derselbe Codepfad.

### 4. Layout

Ein PDF, das aussieht wie ein Screenshot der Web-App, ist unbrauchbar. Nötig:

- Print-Stylesheet: keine Navigation, Seitenrail, Buttons; sinnvolle
  Seitenumbrüche (`break-inside: avoid` für Codeblöcke und Tabellen).
- Kopf-/Fußzeile mit Seitentitel, Space, Exportdatum, Seitenzahl.
- Lesbare Typografie und Codeblöcke, die nicht rechts abgeschnitten werden.
- Dark-Mode-Farben dürfen nicht ins PDF durchschlagen.

## Nicht im Scope

- Seitenzahlen im Inhaltsverzeichnis / Cross-Reference-Auflösung über PDFs hinweg.
- Wasserzeichen, Passwortschutz, Signatur.
- Kommentare oder Revisionen im PDF.
- Asynchroner Export mit Benachrichtigung bei Fertigstellung (falls das
  Zeitbudget nicht reicht: lieber Grenze + klare Fehlermeldung als ein Request,
  der zwei Minuten offen steht).

## Offene Entscheidung — mit dem Menschen klären, nicht raten

**Headless Chromium (Playwright/Puppeteer) vs. JS-PDF-Bibliothek.**

|             | Chromium                                                                                 | JS-Bibliothek (z. B. pdfmake)    |
| ----------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| Treue       | hoch — dasselbe CSS wie die App                                                          | mäßig, eigenes Layoutmodell      |
| Image-Größe | +300–500 MB im Server-Image                                                              | vernachlässigbar                 |
| Betrieb     | Sandbox-Flags, Zombie-Prozesse, RAM-Spitzen; berührt die Health-Checks und den Installer | unauffällig                      |
| Aufwand     | Print-CSS wiederverwendbar                                                               | Mapping ProseMirror→PDF von Hand |

Das ist eine Betriebsentscheidung, keine technische Vorliebe: Das Projekt
verkauft sich über „einzige Voraussetzung ist Docker" (README) und einen
geführten Installer. Ein halbes Gigabyte Chromium im Image und ein zusätzlicher
Ausfallmodus wiegen dort schwerer als anderswo.

Falls Chromium gewählt wird, ist ein **separater Container** die ernsthafte
Variante — dann bleibt das API-Image schlank, und der Ausfall des PDF-Dienstes
nimmt nicht die API mit. Das kostet aber einen Compose-Service, einen
Health-Check und eine Installer-Frage.

## Akzeptanzkriterien

`apps/server/tests/space-exports.test.ts` (erweitern):

- `format=pdf` liefert ein ZIP, dessen Einträge gültige PDFs sind
  (`%PDF-`-Header, Seitenzahl > 0).
- Die Verzeichnisstruktur entspricht der der anderen Formate.
- Ein Bild aus dem Object Store ist im PDF eingebettet (Dateigröße bzw.
  extrahierte Ressourcen prüfen).
- Ohne `space:export`-Berechtigung: 403.
- Ein Space aus einer anderen Organisation: 404/403.
- Einzelseiten-Route: Berechtigung wird auf **Seiten**-Ebene geprüft — eine
  Seite mit restriktivem Per-Page-Override ist für einen Space-Leser nicht
  exportierbar.
- Die konfigurierte Obergrenze greift und ist im Ergebnis sichtbar.

## Migrations-Koordination

Keine Schema-Änderung.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
Dokumentation: `docs/export-format.md` um PDF ergänzen; bei separatem Container
zusätzlich `DEPLOY.md`, `docker-compose.yml` und der Installer.
