// UI metadata for the permission surface, driving the group editor's matrix and
// the group cards' summaries. The *actions* per resource are derived from the
// shared `statement` (the server's single source of truth), so adding an action
// there surfaces it here automatically; only the German labels live locally.

import { statement } from "@nilovon-wiki/auth/permissions";
import type { PermissionRequest, Statement } from "@nilovon-wiki/auth/permissions";

export type Resource = keyof Statement;

export type PermissionAction = { action: string; label: string };

export type PermissionResource = {
  resource: Resource;
  label: string;
  description: string;
  /** Org-management resources: granting these lets a group manage others. */
  dangerous: boolean;
  actions: PermissionAction[];
};

export type PermissionGroup = {
  key: "content" | "organization";
  label: string;
  description: string;
  dangerous: boolean;
  resources: PermissionResource[];
};

const ACTION_LABELS: Record<string, Record<string, string>> = {
  space: { create: "Erstellen", update: "Bearbeiten", delete: "Löschen" },
  page: {
    create: "Erstellen",
    read: "Lesen",
    update: "Bearbeiten",
    delete: "Löschen",
    publish: "Veröffentlichen",
    move: "Verschieben",
  },
  comment: { create: "Schreiben", update: "Bearbeiten", delete: "Löschen", moderate: "Moderieren" },
  attachment: { create: "Hochladen", delete: "Löschen" },
  organization: { update: "Bearbeiten", delete: "Löschen" },
  member: { create: "Hinzufügen", update: "Rollen ändern", delete: "Entfernen" },
  invitation: { create: "Einladen", cancel: "Zurückziehen" },
  team: { create: "Erstellen", update: "Bearbeiten", delete: "Löschen" },
  ac: { create: "Erstellen", read: "Ansehen", update: "Bearbeiten", delete: "Löschen" },
  course: {
    create: "Erstellen",
    read: "Ansehen",
    update: "Bearbeiten",
    delete: "Löschen",
    publish: "Veröffentlichen",
    manage: "Verwalten",
  },
  lesson: { create: "Erstellen", update: "Bearbeiten", delete: "Löschen" },
  enrollment: { create: "Einschreiben", manage: "Teilnehmende verwalten" },
  submission: { grade: "Bewerten" },
};

const RESOURCE_META: Record<Resource, { label: string; description: string }> = {
  space: { label: "Spaces", description: "Sammlungen zusammengehöriger Seiten." },
  page: { label: "Seiten", description: "Die eigentlichen Wiki-Inhalte." },
  comment: { label: "Kommentare", description: "Diskussionen an Seiten." },
  attachment: { label: "Anhänge", description: "Hochgeladene Dateien und Medien." },
  organization: {
    label: "Organisation",
    description: "Name, Einstellungen und Löschung der Organisation.",
  },
  member: {
    label: "Mitglieder",
    description: "Mitglieder hinzufügen, entfernen und ihre Rollen ändern.",
  },
  invitation: {
    label: "Einladungen",
    description: "Personen einladen und Einladungen zurückziehen.",
  },
  team: { label: "Teams", description: "Team-Unterstruktur der Organisation." },
  ac: {
    label: "Rollenverwaltung",
    description: "Gruppen (Rollen) erstellen und deren Rechte vergeben.",
  },
  course: { label: "Kurse", description: "Kurse der Lernplattform." },
  // The three below are listed for completeness of the permission surface, but
  // they are deliberately absent from the group editor: what somebody may do
  // *inside* a course comes from their Kursrolle and their enrolment, not from
  // an org-wide grant.
  lesson: { label: "Lektionen", description: "Inhalte innerhalb eines Kurses." },
  enrollment: { label: "Einschreibungen", description: "Teilnahme an Kursen." },
  submission: { label: "Abgaben", description: "Eingereichte Aufgaben und deren Bewertung." },
};

// Content permissions (page/comment/attachment) are no longer granted here —
// they are governed per-space and per-page via space/page roles. Org groups only
// grant org-level capabilities. `space` stays: it controls who may create and
// org-wide-manage spaces.
const CONTENT_RESOURCES: Resource[] = ["space", "course"];
const ORGANIZATION_RESOURCES: Resource[] = ["organization", "member", "invitation", "team", "ac"];

function buildResource(resource: Resource, dangerous: boolean): PermissionResource {
  const actions = (statement[resource] as readonly string[]).map((action) => ({
    action,
    label: ACTION_LABELS[resource]?.[action] ?? action,
  }));
  return { resource, ...RESOURCE_META[resource], dangerous, actions };
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "content",
    label: "Spaces",
    description:
      "Organisationsweite Space-Rechte. Zugriff auf Inhalte regeln Space- und Seiten-Rollen.",
    dangerous: false,
    resources: CONTENT_RESOURCES.map((resource) => buildResource(resource, false)),
  },
  {
    key: "organization",
    label: "Organisation",
    description:
      "Verwaltungsrechte. Achtung: Damit kann die Gruppe andere Mitglieder und Rollen verwalten.",
    dangerous: true,
    resources: ORGANIZATION_RESOURCES.map((resource) => buildResource(resource, true)),
  },
];

const RESOURCES_BY_KEY = new Map(
  PERMISSION_GROUPS.flatMap((group) => group.resources).map((resource) => [
    resource.resource,
    resource,
  ]),
);

/** Total number of granted actions across all resources. */
export function countGrantedActions(permission: PermissionRequest): number {
  return Object.values(permission).reduce((sum, actions) => sum + (actions?.length ?? 0), 0);
}

/** True if the permission set grants any org-management (dangerous) resource. */
export function hasDangerousGrants(permission: PermissionRequest): boolean {
  return ORGANIZATION_RESOURCES.some(
    (resource) => (permission[resource as keyof PermissionRequest]?.length ?? 0) > 0,
  );
}

export type PermissionSummaryEntry = {
  resource: Resource;
  label: string;
  actions: string[];
  dangerous: boolean;
};

/** Human-readable summary of a permission set, for group cards. */
export function summarizePermission(permission: PermissionRequest): PermissionSummaryEntry[] {
  const entries: PermissionSummaryEntry[] = [];
  for (const [resource, meta] of RESOURCES_BY_KEY) {
    const granted = permission[resource as keyof PermissionRequest];
    if (!granted?.length) continue;
    entries.push({
      resource,
      label: meta.label,
      dangerous: meta.dangerous,
      actions: granted.map(
        (action) => meta.actions.find((candidate) => candidate.action === action)?.label ?? action,
      ),
    });
  }
  return entries;
}
