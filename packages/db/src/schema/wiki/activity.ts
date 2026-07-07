import { text, jsonb, index } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { activityAction } from "./enums";
import { space } from "./spaces";
import { page } from "./pages";
import { user, organization } from "../auth";

/** Append-only audit log, also used to build activity feeds. */
export const activity = wikiSchema.table(
  "activity",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: text("space_id").references(() => space.id, { onDelete: "set null" }),
    pageId: text("page_id").references(() => page.id, { onDelete: "set null" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: activityAction("action").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("activity_org_created_idx").on(t.organizationId, t.createdAt),
    index("activity_space_idx").on(t.spaceId),
    index("activity_page_idx").on(t.pageId),
  ],
);
