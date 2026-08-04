import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { organizationRetentionSetting } from "@nilovon-wiki/db/schema/index";

/** Accepts the db handle or a transaction — both expose the writes used here. */
type Executor = Pick<Database, "insert" | "update" | "select">;

/**
 * How long one organization keeps its data. `null` audit retention means
 * "forever", and that is the default for a reason: an update that started
 * quietly trimming the audit log would destroy the very record the log exists
 * to provide. Shortening the window is an explicit admin decision, and one the
 * log itself keeps (see the protected actions in `purge-audit.ts`).
 */
export type RetentionPolicy = {
  auditRetentionDays: number | null;
  trashRetentionDays: number;
};

/**
 * Used for an organization that has no row yet. Must mirror the column defaults
 * in `organization_retention_setting`, so an org behaves identically before and
 * after an admin first opens the settings page.
 */
export const RETENTION_DEFAULTS: RetentionPolicy = {
  auditRetentionDays: null,
  trashRetentionDays: 30,
};

/** Bounds accepted from the API, mirrored by the zod input schema. */
export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;

export async function loadRetentionPolicy(
  db: Database,
  organizationId: string,
): Promise<RetentionPolicy> {
  const row = await db.query.organizationRetentionSetting.findFirst({
    where: eq(organizationRetentionSetting.organizationId, organizationId),
    columns: { auditRetentionDays: true, trashRetentionDays: true },
  });
  return row ?? RETENTION_DEFAULTS;
}

/**
 * Writes the policy, creating the row on first save. The runner claims work on
 * this same row, so the upsert deliberately touches only the policy columns and
 * leaves `purgeClaimedAt`/`lastPurgeAt` to the runner.
 */
export async function saveRetentionPolicy(
  db: Executor,
  organizationId: string,
  policy: RetentionPolicy,
): Promise<RetentionPolicy> {
  await db
    .insert(organizationRetentionSetting)
    .values({ organizationId, ...policy })
    .onConflictDoUpdate({
      target: organizationRetentionSetting.organizationId,
      set: { ...policy, updatedAt: new Date() },
    });
  return policy;
}

/**
 * Ensures every organization has a row, so the runner has something to claim
 * against. Idempotent, and cheap enough to repeat on every run: without it an
 * org that never opened the settings page could never be claimed, and its trash
 * would therefore never expire.
 */
export async function ensureRetentionRows(db: Executor, organizationIds: string[]): Promise<void> {
  if (organizationIds.length === 0) return;
  await db
    .insert(organizationRetentionSetting)
    .values(organizationIds.map((organizationId) => ({ organizationId })))
    .onConflictDoNothing();
}

/** When a row deleted at `deletedAt` leaves the trash for good. */
export function trashExpiresAt(deletedAt: Date, trashRetentionDays: number): Date {
  return new Date(deletedAt.getTime() + trashRetentionDays * 24 * 60 * 60 * 1000);
}

/** The instant a trash sweep running at `now` treats as "deleted long enough". */
export function trashCutoff(now: Date, trashRetentionDays: number): Date {
  return new Date(now.getTime() - trashRetentionDays * 24 * 60 * 60 * 1000);
}

/** The instant an audit sweep running at `now` treats as "old enough". */
export function auditCutoff(now: Date, auditRetentionDays: number): Date {
  return new Date(now.getTime() - auditRetentionDays * 24 * 60 * 60 * 1000);
}
