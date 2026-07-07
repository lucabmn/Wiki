import { sql, type SQL } from "drizzle-orm";
import {
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps, tsvector } from "../_helpers";
import { pageStatus } from "./enums";
import { space } from "./spaces";
import { user } from "../auth";

/** A wiki page. Pages form a tree within a space via `parentId`. `wiki.page`. */
export const page = wikiSchema.table(
  "page",
  {
    id: id(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    // Self-reference for the page tree. null = top level of the space.
    parentId: text("parent_id").references((): AnyPgColumn => page.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull().default("Untitled"),
    slug: text("slug").notNull(),
    icon: text("icon"),
    coverImage: text("cover_image"),
    // Editor source of truth (ProseMirror / TipTap JSON). Switch to text() if
    // you prefer raw markdown as the canonical format.
    content: jsonb("content"),
    // Plaintext projection of `content`, kept in sync in app code. Powers search
    // and previews without parsing the JSON doc.
    textContent: text("text_content").notNull().default(""),
    status: pageStatus("status").notNull().default("draft"),
    isTemplate: boolean("is_template").notNull().default(false),
    // Fractional / LexoRank ordering among siblings (cheap reorders).
    position: text("position").notNull().default("a0"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    lastEditedBy: text("last_edited_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
    // Generated FTS vector: title weighted higher (A) than body (B).
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${page.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${page.textContent}, '')), 'B')`,
    ),
  },
  (t) => [
    uniqueIndex("page_space_slug_uq").on(t.spaceId, t.slug),
    index("page_space_status_idx").on(t.spaceId, t.status),
    index("page_parent_idx").on(t.parentId),
    index("page_search_idx").using("gin", t.searchVector),
  ],
);

/** Immutable snapshots of a page for version history / diffing / restore. */
export const pageRevision = wikiSchema.table(
  "page_revision",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content"),
    textContent: text("text_content").notNull().default(""),
    summary: text("summary"), // optional change note
    editedBy: text("edited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("page_revision_uq").on(t.pageId, t.version),
    index("page_revision_page_idx").on(t.pageId),
  ],
);

/** Per-user autosave draft so unpublished edits aren't lost. One per user/page. */
export const pageDraft = wikiSchema.table(
  "page_draft",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    content: jsonb("content"),
    ...timestamps,
  },
  (t) => [uniqueIndex("page_draft_uq").on(t.pageId, t.userId)],
);
