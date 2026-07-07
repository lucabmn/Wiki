import { customType, text, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// Better Auth uses text IDs, so we do too - keep foreign keys join-compatible with the auth tables.
export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

// Timestamps are a common pattern, so we provide a helper for them.
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Postgres full-text search column type. (not supported by Drizzle yet, so we define it ourselves)
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
