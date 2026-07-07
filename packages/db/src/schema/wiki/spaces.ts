import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps } from "../_helpers";
import { wikiSchema } from "./_schema";
import { organization, team, user } from "../auth";
import { permissionSubject, spaceVisibility, wikiRole } from "./enums";

export const space = wikiSchema.table(
  "space",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"), // emoji or icon key
    color: text("color"), // hex color code
    visibility: spaceVisibility("visibility").notNull().default("private"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("space_org_slug_uq").on(t.organizationId, t.slug),
    index("space_org_idx").on(t.organizationId),
  ],
);

/**
 * Explicit grants to a space for a user OR a team. Combine with
 * `space.visibility` to resolve access:
 *   open       -> org members get `defaultRole`, overridden by rows here
 *   restricted -> only subjects listed here
 *   private    -> creator + subjects listed here
 */
export const spaceMember = wikiSchema.table(
  "space_member",
  {
    id: id(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    subject: permissionSubject("subject").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => team.id, { onDelete: "cascade" }),
    role: wikiRole("role").notNull().default("editor"),
    ...timestamps,
  },
  (t) => [
    // NULLs are treated as distinct in Postgres, so these two coexist cleanly.
    uniqueIndex("space_member_user_uq").on(t.spaceId, t.userId),
    uniqueIndex("space_member_team_uq").on(t.spaceId, t.teamId),
    index("space_member_space_idx").on(t.spaceId),
  ],
);
