import { z } from "zod";

/** A cuid2 identifier as issued by the db `id()` helper. */
export const IdSchema = z.string().min(1).max(32);

/** URL segment for spaces, pages, courses and topics — what `slugify` produces. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche (z. B. „mein-bereich“).",
  );

/** `#rgb` or `#rrggbb`, as the color pickers emit it. */
export const HexColorSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "Gib eine Farbe als Hex-Code ein (z. B. #3b82f6).",
  );

export const WikiRoleSchema = z.enum(["viewer", "commenter", "editor", "admin"]);

/**
 * `roleName` of a group grant — an org role name. Bounded like any other free
 * text so a grant row cannot carry an arbitrarily large string.
 */
export const GrantRoleNameSchema = z.string().trim().min(1).max(100);

/**
 * The subject of an ACL grant must name its principal: a user grant a user, a
 * team grant a team, a group grant a role name.
 */
export function grantNamesSubject(v: {
  subject: "user" | "team" | "role";
  userId?: string;
  teamId?: string;
  roleName?: string;
}): boolean {
  return v.subject === "user" ? !!v.userId : v.subject === "team" ? !!v.teamId : !!v.roleName;
}

export const GRANT_SUBJECT_MESSAGE =
  "Wähle eine Person, ein Team oder eine Gruppe aus, die Zugriff bekommen soll.";
