import { text, index, uniqueIndex } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { page } from "./pages";

/** Internal wiki links — the source of a backlinks / graph feature. */
export const pageLink = wikiSchema.table(
  "page_link",
  {
    id: id(),
    sourcePageId: text("source_page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    targetPageId: text("target_page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("page_link_uq").on(t.sourcePageId, t.targetPageId),
    index("page_link_target_idx").on(t.targetPageId), // fast backlink lookup
  ],
);
