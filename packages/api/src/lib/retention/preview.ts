import { and, count, eq, isNotNull, lt, notInArray } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { activity, page, space } from "@nilovon-wiki/db/schema/index";

import { firstRow } from "../rows";
import { PROTECTED_AUDIT_ACTIONS } from "./purge-audit";
import { auditCutoff, trashCutoff } from "./settings";

/**
 * What a proposed policy would remove on the next run.
 *
 * Shortening a window deletes data, and an admin cannot consent to something
 * they cannot see. The confirmation dialog is built on these counts, so the
 * question it asks is "delete 41 200 audit entries?" rather than the useless
 * "are you sure?".
 *
 * Deletion blocks are intentionally *not* subtracted here. The counts are an
 * upper bound the admin is warned about, and quietly reporting fewer rows than
 * the window covers would make a later, post-release purge look like a bug.
 */
export type RetentionImpact = {
  auditRows: number;
  trashedPages: number;
  trashedSpaces: number;
};

export async function previewRetentionImpact(
  db: Database,
  input: {
    organizationId: string;
    auditRetentionDays: number | null;
    trashRetentionDays: number;
    now?: Date;
  },
): Promise<RetentionImpact> {
  const now = input.now ?? new Date();

  const auditRows =
    input.auditRetentionDays === null
      ? 0
      : firstRow(
          await db
            .select({ n: count() })
            .from(activity)
            .where(
              and(
                eq(activity.organizationId, input.organizationId),
                lt(activity.createdAt, auditCutoff(now, input.auditRetentionDays)),
                notInArray(activity.action, PROTECTED_AUDIT_ACTIONS),
              ),
            ),
        ).n;

  const cutoff = trashCutoff(now, input.trashRetentionDays);
  const [pages, spaces] = await Promise.all([
    db
      .select({ n: count() })
      .from(page)
      .innerJoin(space, eq(page.spaceId, space.id))
      .where(
        and(
          eq(space.organizationId, input.organizationId),
          isNotNull(page.deletedAt),
          lt(page.deletedAt, cutoff),
        ),
      ),
    db
      .select({ n: count() })
      .from(space)
      .where(
        and(
          eq(space.organizationId, input.organizationId),
          isNotNull(space.deletedAt),
          lt(space.deletedAt, cutoff),
        ),
      ),
  ]);

  return {
    auditRows,
    trashedPages: firstRow(pages).n,
    trashedSpaces: firstRow(spaces).n,
  };
}
