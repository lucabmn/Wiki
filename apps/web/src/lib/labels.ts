// Human-readable German labels for API enum values, shared across routes.

export const ACTION_LABEL: Record<string, string> = {
  "space.created": "Space erstellt",
  "space.updated": "Space aktualisiert",
  "space.archived": "Space archiviert",
  "space.deleted": "Space gelöscht",
  "page.created": "Seite erstellt",
  "page.updated": "Seite bearbeitet",
  "page.published": "Seite veröffentlicht",
  "page.moved": "Seite verschoben",
  "page.archived": "Seite archiviert",
  "page.restored": "Seite wiederhergestellt",
  "page.deleted": "Seite gelöscht",
  "comment.created": "Kommentar hinzugefügt",
  "comment.resolved": "Kommentar gelöst",
  "comment.deleted": "Kommentar gelöscht",
  "attachment.uploaded": "Datei hochgeladen",
  "attachment.deleted": "Datei gelöscht",
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
