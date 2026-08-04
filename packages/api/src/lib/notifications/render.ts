import type { ActivityAction } from "../activity";
import { pageHref } from "../page-href";
import type { DigestContent, DigestEntry } from "./collect";
import { safeTimeZone } from "./schedule";

/**
 * Renders one digest as an email. Kept free of db and env imports so the
 * output is a pure function of its arguments — the preview endpoint and the
 * runner render through the same path, and tests need no fixtures.
 *
 * Deliberately table-and-inline-styles HTML: mail clients strip <style> blocks
 * and know nothing of flexbox. Matches the house style set by `actionMail`.
 */

export type DigestMailInput = {
  organizationName: string;
  recipientName: string | null;
  appName: string;
  /** Origin of the web app, used to link entries. No trailing slash. */
  webUrl: string;
  timezone: string;
  from: Date;
  to: Date;
  content: DigestContent;
};

export type RenderedMail = {
  subject: string;
  text: string;
  html: string;
};

// Third person singular, so a line reads "Anna hat die Seite »X« erstellt".
const ACTION_PHRASES: Record<ActivityAction, { verb: string; noun: string }> = {
  "space.created": { verb: "hat den Bereich erstellt", noun: "Bereich" },
  "space.updated": { verb: "hat den Bereich bearbeitet", noun: "Bereich" },
  "space.archived": { verb: "hat den Bereich archiviert", noun: "Bereich" },
  "space.deleted": { verb: "hat den Bereich gelöscht", noun: "Bereich" },
  "page.created": { verb: "hat die Seite erstellt", noun: "Seite" },
  "page.updated": { verb: "hat die Seite bearbeitet", noun: "Seite" },
  "page.published": { verb: "hat die Seite veröffentlicht", noun: "Seite" },
  "page.moved": { verb: "hat die Seite verschoben", noun: "Seite" },
  "page.archived": { verb: "hat die Seite archiviert", noun: "Seite" },
  "page.restored": { verb: "hat die Seite wiederhergestellt", noun: "Seite" },
  "page.deleted": { verb: "hat die Seite gelöscht", noun: "Seite" },
  "comment.created": { verb: "hat kommentiert:", noun: "Seite" },
  "comment.resolved": { verb: "hat einen Kommentar aufgelöst:", noun: "Seite" },
  "comment.deleted": { verb: "hat einen Kommentar gelöscht:", noun: "Seite" },
  "attachment.uploaded": { verb: "hat einen Anhang hochgeladen:", noun: "Seite" },
  "attachment.deleted": { verb: "hat einen Anhang gelöscht:", noun: "Seite" },
  // Never reach a digest — `categoryForAction` maps them to no category — but
  // the map is exhaustive over the enum so a future reader finds real copy here
  // instead of a crash.
  "impersonation.started": { verb: "wurde von der Administration übernommen", noun: "Konto" },
  "impersonation.ended": { verb: "ist nicht mehr übernommen", noun: "Konto" },
};

const UNKNOWN_ACTOR = "Jemand";
const UNTITLED = "Ohne Titel";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function entryLine(entry: DigestEntry): string {
  const phrase = ACTION_PHRASES[entry.action];
  const actor = entry.actorName ?? UNKNOWN_ACTOR;
  const title = entry.title ?? UNTITLED;
  return `${actor} ${phrase.verb} „${title}“`;
}

/** Groups entries by space so the mail reads as a per-area report. */
function groupBySpace(entries: DigestEntry[]): { name: string; entries: DigestEntry[] }[] {
  const groups = new Map<string, { name: string; entries: DigestEntry[] }>();
  for (const entry of entries) {
    const key = entry.spaceId ?? "__none__";
    let group = groups.get(key);
    if (!group) {
      group = { name: entry.spaceName ?? "Ohne Bereich", entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  // Oldest first within a group: a digest reads as a chronology, while the
  // query fetched newest-first to cap correctly.
  for (const group of groups.values()) {
    group.entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function renderDigestMail(input: DigestMailInput): RenderedMail {
  const timezone = safeTimeZone(input.timezone);
  const { entries, truncated } = input.content;
  const groups = groupBySpace(entries);
  const period = `${formatDate(input.from, timezone)} – ${formatDate(input.to, timezone)}`;
  const settingsUrl = `${input.webUrl}/settings/notifications`;

  const count = entries.length;
  const subject =
    count === 0
      ? `${input.appName}: Zusammenfassung für ${input.organizationName} — keine Änderungen`
      : `${input.appName}: ${count} ${count === 1 ? "Änderung" : "Änderungen"} in ${input.organizationName}`;

  const greeting = input.recipientName ? `Hallo ${input.recipientName},` : "Hallo,";
  const intro =
    count === 0
      ? `im Zeitraum ${period} gab es in ${input.organizationName} keine Änderungen, die deinen Einstellungen entsprechen.`
      : `hier ist deine Zusammenfassung für ${input.organizationName} (${period}).`;

  const textBlocks = groups.map((group) => {
    const lines = group.entries.map(
      (entry) =>
        `  - ${entryLine(entry)} (${formatDateTime(entry.createdAt, timezone)})` +
        (entry.pageId ? `\n    ${input.webUrl}${pageHref(entry.pageId)}` : ""),
    );
    return `${group.name}\n${lines.join("\n")}`;
  });

  const truncatedNote =
    truncated > 0
      ? `\nWeitere ${truncated} Änderungen sind in dieser Zusammenfassung nicht enthalten.\n`
      : "";

  const text = [
    greeting,
    "",
    intro,
    "",
    textBlocks.join("\n\n"),
    truncatedNote,
    "",
    `Einstellungen anpassen: ${settingsUrl}`,
    "",
  ].join("\n");

  const htmlGroups = groups
    .map((group) => {
      const items = group.entries
        .map((entry) => {
          const line = escapeHtml(entryLine(entry));
          const when = escapeHtml(formatDateTime(entry.createdAt, timezone));
          const body = entry.pageId
            ? `<a href="${escapeHtml(`${input.webUrl}${pageHref(entry.pageId)}`)}" style="color:#111;text-decoration:underline">${line}</a>`
            : line;
          return `<li style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#333">${body}<br><span style="font-size:12px;color:#888">${when}</span></li>`;
        })
        .join("");
      return `<h2 style="margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#666">${escapeHtml(group.name)}</h2><ul style="margin:0;padding:0 0 0 18px">${items}</ul>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111">
  <table role="presentation" style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <tr><td>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(input.organizationName)}</h1>
      <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#444">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#444">${escapeHtml(intro)}</p>
      ${htmlGroups}
      ${
        truncated > 0
          ? `<p style="margin:16px 0 0;font-size:13px;color:#666">Weitere ${truncated} Änderungen sind in dieser Zusammenfassung nicht enthalten.</p>`
          : ""
      }
      <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#777">
        Du bekommst diese E-Mail, weil gebündelte Benachrichtigungen für dich aktiv sind.<br>
        <a href="${escapeHtml(settingsUrl)}" style="color:#555">Einstellungen anpassen</a>
      </p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
