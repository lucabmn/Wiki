import { text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { page } from "./pages";
import { user } from "../auth";

/**
 * Curated outbound references of a page — the specs, tickets and vendor docs a
 * team keeps next to an article. Deliberately a table rather than links inside
 * the body: these are metadata (editable without touching the document, listed
 * even while the page is an unpublished draft) and they survive a body rewrite.
 * The in-body counterpart is the TipTap `link` mark; internal ones are mirrored
 * into `pageLink` for backlinks (see `links.ts`).
 *
 * `url` holds an absolute http(s) address in its normalized form: the write
 * path allowlists the scheme and strips embedded credentials before inserting,
 * so a row here is always something safe to put in an `href`.
 */
export const pageExternalLink = wikiSchema.table(
  "page_external_link",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // Manual order within the page's list. A plain integer, renumbered on
    // reorder: unlike the page tree this list is short (a handful of entries per
    // page) and only ever reordered one step at a time, so fractional indexing
    // would buy nothing for its complexity.
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // One row per target: re-adding a URL edits the existing entry instead of
    // silently duplicating it. The cost is that the same URL can't be listed
    // twice under two titles — deep links differing only by fragment still can,
    // since the fragment is part of the stored URL.
    uniqueIndex("page_external_link_uq").on(t.pageId, t.url),
    index("page_external_link_page_idx").on(t.pageId, t.position),
  ],
);
