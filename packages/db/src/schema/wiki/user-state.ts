import { text, primaryKey, index } from "drizzle-orm/pg-core";

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
  (t) => [
    primaryKey({ columns: [t.userId, t.pageId] }),
    // The composite PK leads with userId, so it can't serve pageId-only
    // lookups ("who watches this page?") needed to notify subscribers.
    index("page_subscription_page_idx").on(t.pageId),
  ],
);
