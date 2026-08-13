import { pgSchema } from "drizzle-orm/pg-core";

/**
 * The learning platform lives in its own Postgres schema, next to `wiki`.
 *
 * Courses are a peer product, not a kind of page: they have their own access
 * axis (enrolment), their own authoring roles, and their own lifecycle. Keeping
 * the tables in a separate namespace means neither product's migrations, backup
 * filters or `schemaFilter` entries have to know about the other's tables.
 */
export const learnSchema = pgSchema("learn");
