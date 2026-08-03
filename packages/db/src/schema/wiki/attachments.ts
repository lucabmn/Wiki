import { text, bigint, boolean, index, timestamp } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { space } from "./spaces";
import { page } from "./pages";
import { user } from "../auth";

export const attachment = wikiSchema.table(
  "attachment",
  {
    id: id(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    // null = orphaned upload (e.g. pasted then page deleted); clean up via job.
    pageId: text("page_id").references(() => page.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(), // key in S3 / local disk
    checksum: text("checksum"),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    // Editor/import uploads stay writer-only until the page is published.
    isDraft: boolean("is_draft").default(false).notNull(),
    // Sidebar attachments added before first publication become public with the
    // page even when they are not embedded in rich text.
    publishOnNextPublish: boolean("publish_on_next_publish").default(false).notNull(),
    // Persisted before touching object storage so failed deletes are retryable.
    deletionPendingAt: timestamp("deletion_pending_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("attachment_space_idx").on(t.spaceId),
    index("attachment_page_idx").on(t.pageId),
    index("attachment_uploaded_by_idx").on(t.uploadedBy),
  ],
);
