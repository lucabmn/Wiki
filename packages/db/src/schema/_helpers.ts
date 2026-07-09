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

// Raw binary column (Postgres `bytea`). Used to persist the Yjs CRDT snapshot of
// a collaboratively edited page. Drizzle has no first-class bytea type, so we
// map it to a Node/Bun `Uint8Array` in both directions.
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});
