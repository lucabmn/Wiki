import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { organizationSetting } from "@nilovon-wiki/db/schema/index";

/**
 * The org-scoped policy row, read on the request path by the two-factor
 * middleware. New policies (session lifetime, password rules, allowed e-mail
 * domains) land here rather than in a table of their own — see the schema.
 */
export type OrganizationSettings = {
  twoFactorRequired: boolean;
  twoFactorGraceUntil: Date | null;
  twoFactorRequireForSso: boolean;
};

/**
 * What an organization without a row gets. Must mirror the column defaults, so
 * inserting the row with these values is a no-op change in behaviour.
 */
export const ORGANIZATION_SETTINGS_DEFAULTS: OrganizationSettings = {
  twoFactorRequired: false,
  twoFactorGraceUntil: null,
  twoFactorRequireForSso: false,
};

/**
 * Every authenticated request consults this policy, so reading it from the
 * database each time would add a query to the hot path — the same problem
 * Better Auth solves for the session with its 5-minute cookie cache.
 *
 * A 5-minute TTL would be unacceptable here though: an admin who switches the
 * requirement on expects it to bite now, not eventually. So the cache is
 * written through — `saveOrganizationSettings` drops the entry it just changed
 * — and the TTL exists only as a backstop for the *other* processes in a
 * multi-instance deployment, which is why it is seconds rather than minutes.
 */
const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: OrganizationSettings; expiresAt: number };

const cache = new Map<string, CacheEntry>();

/** The organization's policy, from cache when warm. */
export async function loadOrganizationSettings(
  db: Database,
  organizationId: string,
): Promise<OrganizationSettings> {
  const cached = cache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const row = await db.query.organizationSetting.findFirst({
    where: eq(organizationSetting.organizationId, organizationId),
  });
  const value: OrganizationSettings = row
    ? {
        twoFactorRequired: row.twoFactorRequired,
        twoFactorGraceUntil: row.twoFactorGraceUntil,
        twoFactorRequireForSso: row.twoFactorRequireForSso,
      }
    : ORGANIZATION_SETTINGS_DEFAULTS;

  cache.set(organizationId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Upserts the policy and invalidates the cache in the same breath. Callers must
 * not write `organization_setting` directly — a stale entry here means a policy
 * change that appears to have been saved but is not being enforced.
 */
export async function saveOrganizationSettings(
  // Accepts the db handle or a transaction, so the write and its audit row
  // commit together — same contract as `recordActivity`.
  db: { insert: Database["insert"] },
  organizationId: string,
  settings: OrganizationSettings,
): Promise<OrganizationSettings> {
  await db
    .insert(organizationSetting)
    .values({ organizationId, ...settings })
    .onConflictDoUpdate({
      target: organizationSetting.organizationId,
      set: { ...settings, updatedAt: new Date() },
    });

  invalidateOrganizationSettings(organizationId);
  return settings;
}

/** Drops one organization's cached policy, or the whole cache when omitted. */
export function invalidateOrganizationSettings(organizationId?: string): void {
  if (organizationId === undefined) {
    cache.clear();
    return;
  }
  cache.delete(organizationId);
}
