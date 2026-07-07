import { text, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { space } from "./spaces";
import { page } from "./pages";

export const tag = wikiSchema.table(
  "tag",
  {
    id: id(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tag_space_name_uq").on(t.spaceId, t.name)],
);

/** Many-to-many join between pages and tags. */
export const pageTag = wikiSchema.table(
  "page_tag",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  // PK covers pageId-prefixed lookups; this index powers the reverse (pages by tag).
  (t) => [primaryKey({ columns: [t.pageId, t.tagId] }), index("page_tag_tag_idx").on(t.tagId)],
);
