// Human-readable German labels for API enum values, shared across routes.

export const ACTION_LABEL: Record<string, string> = {
  "space.created": "Space erstellt",
  "space.updated": "Space aktualisiert",
  "space.archived": "Space archiviert",
  "space.restored": "Space wiederhergestellt",
  // "gelöscht" is the trash, "endgültig gelöscht" is the purge. The feed has to
  // keep the two apart, because only one of them is reversible.
  "space.deleted": "Space in den Papierkorb",
  "space.untrashed": "Space aus dem Papierkorb geholt",
  "space.purged": "Space endgültig gelöscht",
  "page.created": "Seite erstellt",
  "page.updated": "Seite bearbeitet",
  "page.published": "Seite veröffentlicht",
  "page.moved": "Seite verschoben",
  "page.archived": "Seite archiviert",
  "page.restored": "Seite wiederhergestellt",
  "page.deleted": "Seite in den Papierkorb",
  "page.untrashed": "Seite aus dem Papierkorb geholt",
  "page.purged": "Seite endgültig gelöscht",
  "comment.created": "Kommentar hinzugefügt",
  "comment.resolved": "Kommentar gelöst",
  "comment.deleted": "Kommentar gelöscht",
  "attachment.uploaded": "Datei hochgeladen",
  "attachment.deleted": "Datei gelöscht",
  "organization.two_factor_enabled": "Zwei-Faktor-Pflicht aktiviert",
  "organization.two_factor_disabled": "Zwei-Faktor-Pflicht deaktiviert",
  "organization.two_factor_grace_updated": "Zwei-Faktor-Pflicht geändert",
  "webhook.created": "Webhook angelegt",
  "webhook.updated": "Webhook geändert",
  "webhook.deleted": "Webhook entfernt",
  "retention.updated": "Aufbewahrungsfristen geändert",
  "retention.purged": "Abgelaufene Daten gelöscht",
  "hold.created": "Löschsperre gesetzt",
  "hold.released": "Löschsperre aufgehoben",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

export const VISIBILITY_LABEL: Record<string, string> = {
  public: "Öffentlich",
  private: "Privat",
  restricted: "Eingeschränkt",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  member: "Mitglied",
};

export const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
};

/** Per-space roles (wikiRole), distinct from org roles above. */
export const WIKI_ROLE_LABEL: Record<string, string> = {
  viewer: "Leser",
  commenter: "Kommentator",
  editor: "Bearbeiter",
  admin: "Administrator",
};

export const WIKI_ROLE_DESCRIPTION: Record<string, string> = {
  viewer: "Kann lesen.",
  commenter: "Kann lesen und kommentieren.",
  editor: "Kann Inhalte erstellen und bearbeiten.",
  admin: "Kann den Space verwalten und Mitglieder festlegen.",
};
