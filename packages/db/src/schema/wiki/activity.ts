import { text, jsonb, index } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { activityAction } from "./enums";
import { space } from "./spaces";
import { page } from "./pages";
import { user, organization } from "../auth";
import { course } from "../learn/courses";

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
    /**
     * The course an entry belongs to, for the learning product. Sibling of
     * `spaceId`: the two are the top-level containers a feed can be scoped to,
     * and exactly one of them is set on any given row.
     */
    courseId: text("course_id").references(() => course.id, { onDelete: "set null" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * The instance admin behind `actorId` when the row was written during an
     * impersonated session. Without it the feed would credit an edit purely to
     * the impersonated account and the admin's involvement would only be
     * reconstructable by lining up timestamps against `admin.admin_audit`.
     */
    impersonatedBy: text("impersonated_by").references(() => user.id, { onDelete: "set null" }),
    action: activityAction("action").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("activity_org_created_idx").on(t.organizationId, t.createdAt),
    index("activity_space_idx").on(t.spaceId),
    index("activity_page_idx").on(t.pageId),
    index("activity_course_idx").on(t.courseId),
  ],
);
