import { text, primaryKey } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { timestamps } from "../_helpers";
import { page } from "./pages";
import { user } from "../auth";

export const favorite = wikiSchema.table(
  "favorite",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

/** Watch a page to get notified on changes/comments. */
export const pageSubscription = wikiSchema.table(
  "page_subscription",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);
