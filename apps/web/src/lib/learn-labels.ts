// German labels for the learning platform's enum values, kept beside the wiki's
// `labels.ts` rather than merged into it: the two products share an
// organization, not a vocabulary, and a single map would make it easy to
// silently reuse a wiki word where a course means something else.

export const COURSE_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

export const COURSE_VISIBILITY_LABEL: Record<string, string> = {
  private: "Privat",
  organization: "Organisation",
  public: "Öffentlich",
};

export const COURSE_VISIBILITY_DESCRIPTION: Record<string, string> = {
  private: "Nur eingeschriebene Personen und das Kursteam sehen den Kurs.",
  organization: "Alle Mitglieder der Organisation finden den Kurs im Katalog.",
  public: "Der Kurs ist auch ohne Anmeldung sichtbar.",
};

export const ENROLLMENT_POLICY_LABEL: Record<string, string> = {
  open: "Offen",
  request: "Auf Anfrage",
  invite: "Nur auf Einladung",
  paid: "Kostenpflichtig",
};

export const ENROLLMENT_POLICY_DESCRIPTION: Record<string, string> = {
  open: "Wer den Kurs sieht, kann sich selbst einschreiben.",
  request: "Anfragen müssen vom Kursteam freigegeben werden.",
  invite: "Nur das Kursteam fügt Teilnehmende hinzu.",
  paid: "Erfordert eine gültige Berechtigung (Kauf oder Freigabe).",
};

export const COURSE_ROLE_LABEL: Record<string, string> = {
  reviewer: "Beobachter",
  assistant: "Assistenz",
  instructor: "Dozent",
  owner: "Kursleitung",
};

export const COURSE_ROLE_DESCRIPTION: Record<string, string> = {
  reviewer: "Kann den Kurs und die Abgaben lesen.",
  assistant: "Kann zusätzlich Abgaben bewerten.",
  instructor: "Kann Inhalte erstellen und bearbeiten.",
  owner: "Kann den Kurs verwalten, veröffentlichen und das Team festlegen.",
};

export const COURSE_LEVEL_LABEL: Record<string, string> = {
  beginner: "Einsteiger",
  intermediate: "Fortgeschritten",
  advanced: "Profi",
};

export const LESSON_KIND_LABEL: Record<string, string> = {
  dynamic: "Text",
  video: "Video",
  embed: "Eingebettet",
  document: "Dokument",
  assignment: "Aufgabe",
  quiz: "Quiz",
};

export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Wartet auf Freigabe",
  active: "Aktiv",
  completed: "Abgeschlossen",
  dropped: "Verlassen",
};

export const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  submitted: "Eingereicht",
  returned: "Zurückgegeben",
  graded: "Bewertet",
};

/**
 * Why the server refused an enrolment. Rendered verbatim to the learner, which
 * is the reason the API returns a reason code instead of a bare 403.
 */
export const ENROLLABILITY_REASON_LABEL: Record<string, string> = {
  ok: "Jetzt einschreiben",
  approval_required: "Teilnahme anfragen",
  already_enrolled: "Du bist bereits eingeschrieben",
  not_visible: "Dieser Kurs ist für dich nicht verfügbar",
  not_published: "Der Kurs ist noch nicht veröffentlicht",
  closed: "Die Einschreibefrist ist abgelaufen",
  full: "Der Kurs ist ausgebucht",
  invite_only: "Nur auf Einladung des Kursteams",
  payment_required: "Kostenpflichtig — Zugang erforderlich",
};

/** Why a lesson is locked, phrased for the learner looking at the outline. */
export const LOCK_REASON_LABEL: Record<string, string> = {
  none: "",
  not_enrolled: "Schreibe dich ein, um diese Lektion zu öffnen",
  drip: "Wird später freigeschaltet",
  sequential: "Schließe zuerst die vorherige Lektion ab",
};

/** "1 Std. 5 Min." from a duration in seconds; empty for null/0. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} Min.`;
  if (minutes === 0) return `${hours} Std.`;
  return `${hours} Std. ${minutes} Min.`;
}

/** "49,00 €" from minor units, in the browser's German locale. */
export function formatPrice(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountCents / 100);
}
