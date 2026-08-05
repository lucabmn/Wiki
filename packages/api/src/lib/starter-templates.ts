// The page templates a fresh organization starts with. An empty template
// catalogue never fills itself: nobody marks their first page as a template
// before they have seen what one is good for.

/** A block in a starter document — enough grammar for a useful skeleton. */
type Block =
  | { heading: string }
  | { paragraph: string }
  | { bullets: readonly string[] }
  | { tasks: readonly string[] };

function paragraphNode(text: string) {
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
}

/**
 * Renders blocks into the editor's ProseMirror JSON plus the plaintext
 * projection the page row carries alongside it (`page.textContent`, which feeds
 * search and previews). Both are produced here so they cannot drift apart.
 */
function buildDocument(blocks: readonly Block[]): { content: unknown; textContent: string } {
  const nodes: unknown[] = [];
  const lines: string[] = [];
  for (const block of blocks) {
    if ("heading" in block) {
      nodes.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: block.heading }],
      });
      lines.push(block.heading);
    } else if ("paragraph" in block) {
      nodes.push(paragraphNode(block.paragraph));
      if (block.paragraph) lines.push(block.paragraph);
    } else if ("bullets" in block) {
      nodes.push({
        type: "bulletList",
        content: block.bullets.map((item) => ({
          type: "listItem",
          content: [paragraphNode(item)],
        })),
      });
      lines.push(...block.bullets);
    } else {
      nodes.push({
        type: "taskList",
        content: block.tasks.map((item) => ({
          type: "taskItem",
          attrs: { checked: false },
          content: [paragraphNode(item)],
        })),
      });
      lines.push(...block.tasks);
    }
  }
  return { content: { type: "doc", content: nodes }, textContent: lines.join("\n") };
}

type StarterTemplate = {
  slug: string;
  title: string;
  icon: string;
  content: unknown;
  textContent: string;
};

function template(
  slug: string,
  title: string,
  icon: string,
  blocks: readonly Block[],
): StarterTemplate {
  return { slug, title, icon, ...buildDocument(blocks) };
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  template("vorlage-meeting-notiz", "Meeting-Notiz", "📝", [
    { paragraph: "Datum, Teilnehmende und Ziel des Termins in einem Satz." },
    { heading: "Agenda" },
    { bullets: ["Thema 1", "Thema 2", "Sonstiges"] },
    { heading: "Notizen" },
    { paragraph: "Was besprochen wurde – kurz, in Stichpunkten." },
    { heading: "Entscheidungen" },
    { bullets: ["Entscheidung und wer sie getroffen hat"] },
    { heading: "Aufgaben" },
    { tasks: ["Aufgabe – wer? bis wann?"] },
  ]),
  template("vorlage-entscheidung", "Entscheidungsvorlage", "⚖️", [
    { paragraph: "Eine Entscheidung, ihre Alternativen und der Grund für die Wahl." },
    { heading: "Kontext" },
    { paragraph: "Welches Problem steht an und warum jetzt?" },
    { heading: "Optionen" },
    { bullets: ["Option A – Vorteile, Nachteile", "Option B – Vorteile, Nachteile"] },
    { heading: "Entscheidung" },
    { paragraph: "Gewählte Option und die Begründung in zwei bis drei Sätzen." },
    { heading: "Konsequenzen" },
    { bullets: ["Was sich dadurch ändert", "Was wir bewusst in Kauf nehmen"] },
  ]),
  template("vorlage-runbook", "Runbook", "🛠️", [
    { paragraph: "Wie ein wiederkehrender Vorgang Schritt für Schritt abläuft." },
    { heading: "Wann anwenden" },
    { paragraph: "Das Signal oder der Anlass, der dieses Runbook auslöst." },
    { heading: "Voraussetzungen" },
    { bullets: ["Benötigte Zugänge", "Benötigte Werkzeuge"] },
    { heading: "Ablauf" },
    { tasks: ["Schritt 1", "Schritt 2", "Ergebnis prüfen"] },
    { heading: "Wenn etwas schiefgeht" },
    { bullets: ["Rollback-Schritt", "Wen eskalieren?"] },
  ]),
];
