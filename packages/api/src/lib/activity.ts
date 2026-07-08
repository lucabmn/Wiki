import type { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { activity } from "@nilovon-wiki/db/schema/index";

import type { ActivityActionSchema } from "../schemas/misc";

export type ActivityAction = z.infer<typeof ActivityActionSchema>;

// Accepts either the db handle or a transaction — both expose `insert` with the
// same signature, so activity rows can be written inside the mutation's tx.
type ActivityExecutor = { insert: Database["insert"] };

type RecordActivityInput = {
  organizationId: string;
  action: ActivityAction;
  actorId?: string | null;
  spaceId?: string | null;
  pageId?: string | null;
  // Denormalized context that must survive the referenced row being deleted
  // (e.g. a page's title/id for `page.deleted`, since `activity.pageId` nulls).
  metadata?: unknown;
};

/** Appends one row to the audit log / activity feed. */
export async function recordActivity(
  db: ActivityExecutor,
  input: RecordActivityInput,
): Promise<void> {
  await db.insert(activity).values({
    organizationId: input.organizationId,
    action: input.action,
    actorId: input.actorId ?? null,
    spaceId: input.spaceId ?? null,
    pageId: input.pageId ?? null,
    metadata: input.metadata ?? null,
  });
}
