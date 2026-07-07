import { text, jsonb, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { page } from "./pages";
import { user } from "../auth";

export const comment = wikiSchema.table(
  "comment",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    // Threaded replies.
    parentId: text("parent_id").references((): AnyPgColumn => comment.id, {
      onDelete: "cascade",
    }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    // Optional anchor into the doc for inline/margin comments.
    anchor: jsonb("anchor"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("comment_page_idx").on(t.pageId), index("comment_parent_idx").on(t.parentId)],
);
