import type { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { activity } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import type { ActivityActionSchema } from "../schemas/misc";

export type ActivityAction = z.infer<typeof ActivityActionSchema>;

/**
 * Who to credit an audit row to. During an impersonated session the write is
 * attributed to the account it was made in *and* to the instance admin driving
 * it — an edit that reads as the user's own would hide exactly the thing
 * impersonation has to stay accountable for.
 *
 * Spread into every `recordActivity` call instead of passing `actorId` by hand,
 * so a new mutation cannot forget the second identity.
 */
export function activityActor(context: AuthedContext): {
  actorId: string;
  impersonatedBy: string | null;
} {
  return {
    actorId: context.session.user.id,
    impersonatedBy: context.session.session.impersonatedBy ?? null,
  };
}

// Accepts either the db handle or a transaction — both expose `insert` with the
// same signature, so activity rows can be written inside the mutation's tx.
type ActivityExecutor = { insert: Database["insert"] };

type RecordActivityInput = {
  organizationId: string;
  action: ActivityAction;
  actorId?: string | null;
  /** The instance admin behind `actorId` — see `activityActor`. */
  impersonatedBy?: string | null;
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
    impersonatedBy: input.impersonatedBy ?? null,
    spaceId: input.spaceId ?? null,
    pageId: input.pageId ?? null,
    metadata: input.metadata ?? null,
  });
}
