# T08 — Diagramme / Mermaid

**Ziel:** Diagramme entstehen als Text im Dokument statt als hochgeladenes Bild —
versionierbar, durchsuchbar, ohne externes Werkzeug.

## Ist-Zustand

- `packages/editor/src/index.ts` — die geteilte TipTap-Extension-Liste
  (`pageEditorExtensions`). Vorhanden: StarterKit, Table, TaskList, Image,
  Highlight, TextAlign, Sub-/Superscript, Mention, Placeholder. Kein
  Diagramm- und kein Formel-Node.
- `apps/web/src/components/editor/rich-text-editor.tsx` — kollaborativer Editor.
- `apps/web/src/components/editor/page-content.tsx` — Read-Only-Darstellung.
- `apps/web/src/components/editor/slash-command.tsx` — Slash-Menü, hier kommt
  der Einstiegspunkt hin.
- `apps/server/src/space-export-format.ts` — `documentToHtml` /
  `documentToMarkdown` für den Export.

## Die harte Randbedingung: das Schema ist geteilt

`packages/editor/src/index.ts` ist bewusst client- **und** collab-server-seitig
identisch — der Kommentar am `Mention`-Node sagt das ausdrücklich („must be
identical across …"). Der Hocuspocus-Server (`apps/collab/src/hocuspocus.ts`)
projiziert das Yjs-Dokument zurück nach `content`/`textContent`
(`packages/db/src/schema/wiki/pages.ts:41-45`) und braucht dafür dasselbe
ProseMirror-Schema.

**Ein Diagramm-Node, der nur im Browser existiert, zerstört die Kollaboration**
— der Server kennt den Knotentyp nicht und wirft ihn beim Projizieren weg.

Also: Node-**Spec** (Name, Attribute, `parseHTML`, `renderHTML`, `renderText`)
in `packages/editor/src/index.ts`, ohne Browser-Abhängigkeit. Die
React-Node-View mit dem eigentlichen Rendering kommt getrennt in `apps/web`
dazu, so wie es die Mention-Extension mit ihrer Suggestion-Konfiguration
bereits vormacht.

## Scope

### 1. Node-Spec (`packages/editor`)

- Block-Node, Attribut `source` (der Mermaid-Text), optional `caption`.
- `renderText` **muss** gesetzt sein: sonst landet der rohe Mermaid-Quelltext
  in `textContent` und damit in der Volltextsuche — dann findet die Suche nach
  „graph" jedes Diagramm der Instanz. Vorschlag: Caption ausgeben, sonst nichts.
- Keine Importe, die im Node-Prozess des Collab-Servers nicht laufen.
- `renderHTML` liefert ein deterministisches Element mit dem Quelltext als
  Attribut oder Kindknoten — daran hängen Export und SSR.

### 2. Editor-UI (`apps/web`)

- Node-View mit zwei Zuständen: Quelltext bearbeiten und gerendertes Diagramm.
- Mermaid **lazy laden** (dynamischer Import). Die Bibliothek ist groß und darf
  nicht ins Haupt-Bundle jeder Seite.
- Syntaxfehler im Diagramm werden inline angezeigt, nicht als weiße Fläche und
  erst recht nicht als geworfener Fehler, der den Editor abschießt.
- Eintrag im Slash-Menü (`slash-command.tsx`), Muster von den bestehenden
  Einträgen übernehmen.
- Rendering auch in `page-content.tsx` (Read-Only) und in der
  Revisionsansicht (`revision-history.tsx`).

### 3. Sicherheit

Mermaid rendert SVG aus Benutzereingabe. In einem Wiki schreibt jeder Nutzer
Inhalte, die andere Nutzer angezeigt bekommen — das ist ein XSS-Pfad.

- `securityLevel: "strict"` konfigurieren, `htmlLabels` aus.
- Das erzeugte SVG sanitisieren, bevor es ins DOM geht.
- Beim serverseitigen Rendern (siehe 4) gilt dasselbe.
- Der Editor sanitisiert Links bereits (`page-content.tsx:27-46`, blockt
  `javascript:`) — halte dich an dieselbe Linie und dokumentiere sie im
  Kommentar.

### 4. Export

Ein PDF oder HTML-Export mit rohem Mermaid-Text ist wertlos.

- `documentToHtml` (`apps/server/src/space-export-format.ts`) gibt entweder
  ein gerendertes SVG aus oder — falls serverseitiges Rendern zu teuer ist —
  einen `<pre class="mermaid">`-Block plus einen Hinweis im Export.
- `documentToMarkdown` gibt einen ` ```mermaid `-Codeblock aus. Das ist
  der De-facto-Standard und wird von GitHub und den meisten Viewern gerendert;
  hier gibt es nichts zu erfinden.
- Der Import-Pfad (`packages/api/src/routers/page.ts:412` `import`) sollte
  ` ```mermaid `-Blöcke umgekehrt in den Node überführen — sonst ist der
  Roundtrip kaputt.

## Nicht im Scope

- Weitere Diagrammsprachen (PlantUML, Graphviz, Excalidraw).
- Formelsatz (KaTeX) — verwandt, aber eigenes Ticket.
- Grafisches Diagramm-Editieren.
- Diagramm-Inhalte in der Volltextsuche.

## Offene Entscheidung

**Serverseitiges Rendern für den Export?** Mermaid braucht dafür ein DOM
(jsdom) oder Chromium. Wenn parallel T06 (PDF-Export) läuft und dort ohnehin
Chromium eingeführt wird, ist die Antwort einfach — dann kurz abstimmen.
Ohne das: `<pre class="mermaid">` ausgeben und die Grenze dokumentieren, statt
eine schwere Abhängigkeit für den Export einzuführen.

## Akzeptanzkriterien

`packages/editor` bzw. `apps/web/tests/`:

- Ein Dokument mit Diagramm-Node überlebt Serialisieren → Deserialisieren
  unverändert.
- `renderText` schreibt den Quelltext **nicht** in `textContent` (Test gegen
  die Suchprojektion).
- Ungültige Mermaid-Syntax zeigt eine Fehlermeldung und wirft nicht.
- Ein Diagramm mit `<script>` bzw. einem `javascript:`-Link im Label erzeugt
  kein ausführbares Markup (XSS-Regressionstest — der wichtigste Test hier).
- Mermaid ist nicht Teil des initialen Bundles (Bundle-Assertion oder
  dokumentierte Prüfung).

`apps/server/tests/space-export-format.test.ts`:

- Markdown-Export erzeugt einen ` ```mermaid `-Block.
- HTML-Export erzeugt gemäß der Entscheidung SVG oder `<pre>`.
- Import eines ` ```mermaid `-Blocks ergibt wieder einen Diagramm-Node.

**Kollaborations-Test, nicht optional:** Zwei Clients bearbeiten dieselbe Seite,
einer fügt ein Diagramm ein — nach der Projektion durch den Collab-Server ist
der Node in `content` noch vorhanden. Genau das geht kaputt, wenn die Node-Spec
im falschen Paket liegt.

## Migrations-Koordination

Keine Schema-Änderung an der Datenbank. Aber `packages/editor/src/index.ts`
wird auch von T09 angefasst — Diffs klein halten.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
