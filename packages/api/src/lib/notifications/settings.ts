import { and, eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { organizationDigestSetting, userDigestSetting } from "@nilovon-wiki/db/schema/index";

import type { ActivityAction } from "../activity";

export type DigestFrequency = "off" | "daily" | "weekly" | "monthly";
export type DigestScope = "organization" | "my_spaces" | "subscribed";
export type DigestMode = "inherit" | "custom";
export type DigestCategory =
  | "pages_created"
  | "pages_updated"
  | "pages_removed"
  | "comments"
  | "attachments"
  | "spaces";

/**
 * The schedule + content filter a digest runs on. The organization row supplies
 * every field; a user row may supply any subset, and the rest falls through.
 */
export type DigestPreferences = {
  frequency: DigestFrequency;
  hour: number;
  weekday: number;
  dayOfMonth: number;
  timezone: string;
  categories: DigestCategory[];
  scope: DigestScope;
  skipIfEmpty: boolean;
  includeOwnActivity: boolean;
};

export type OrganizationDigestSettings = DigestPreferences & {
  allowUserOverride: boolean;
};

/** A user's stored override — `null` on every field they did not customise. */
export type UserDigestOverride = {
  mode: DigestMode;
} & { [K in keyof DigestPreferences]: DigestPreferences[K] | null };

/**
 * Fallback used when an organization has no settings row yet. Must mirror the
 * column defaults in `organization_digest_setting`, so an org behaves the same
 * before and after an admin first opens the settings page.
 */
export const ORGANIZATION_DIGEST_DEFAULTS: OrganizationDigestSettings = {
  frequency: "weekly",
  hour: 8,
  weekday: 1, // Monday
  dayOfMonth: 1,
  timezone: "UTC",
  categories: ["pages_created", "pages_updated", "comments"],
  scope: "organization",
  skipIfEmpty: true,
  includeOwnActivity: false,
  allowUserOverride: true,
};

/**
 * Category -> the `activity_action` values it covers. Recipients subscribe to
 * categories, never to raw actions: adding an action to the enum must not
 * require every stored subscription to be migrated.
 */
export const DIGEST_CATEGORY_ACTIONS: Record<DigestCategory, ActivityAction[]> = {
  // Publishing belongs here, not under "updated": a page created as a draft is
  // invisible to a digest until it is published (see `collectDigest`), so for
  // every reader but its author that publish *is* the page appearing.
  pages_created: ["page.created", "page.published"],
  pages_updated: ["page.updated", "page.moved", "page.restored"],
  pages_removed: ["page.archived", "page.deleted"],
  comments: ["comment.created", "comment.resolved", "comment.deleted"],
  attachments: ["attachment.uploaded", "attachment.deleted"],
  spaces: ["space.created", "space.updated", "space.archived", "space.deleted"],
};

const ACTION_CATEGORY = new Map<ActivityAction, DigestCategory>(
  Object.entries(DIGEST_CATEGORY_ACTIONS).flatMap(([category, actions]) =>
    actions.map((action) => [action, category as DigestCategory] as const),
  ),
);

/** The actions a digest with these categories should report. */
export function actionsForCategories(categories: DigestCategory[]): ActivityAction[] {
  const seen = new Set<ActivityAction>();
  for (const category of categories) {
    for (const action of DIGEST_CATEGORY_ACTIONS[category] ?? []) seen.add(action);
  }
  return [...seen];
}

/** The category an action belongs to, or null if it is not reportable. */
export function categoryForAction(action: ActivityAction): DigestCategory | null {
  return ACTION_CATEGORY.get(action) ?? null;
}

/**
 * Folds a user's override onto the organization defaults.
 *
 *  - no row, or `mode: "inherit"`  → the defaults, including later changes.
 *  - `allowUserOverride: false`    → the defaults, unconditionally. The row is
 *                                    kept so turning the switch back on
 *                                    restores what the user had chosen.
 *  - `mode: "custom"`              → each non-null field wins, field by field,
 *                                    so a user can move only the send time.
 */
export function resolveDigestPreferences(
  organization: OrganizationDigestSettings,
  override: UserDigestOverride | null,
): DigestPreferences {
  const base: DigestPreferences = {
    frequency: organization.frequency,
    hour: organization.hour,
    weekday: organization.weekday,
    dayOfMonth: organization.dayOfMonth,
    timezone: organization.timezone,
    categories: organization.categories,
    scope: organization.scope,
    skipIfEmpty: organization.skipIfEmpty,
    includeOwnActivity: organization.includeOwnActivity,
  };
  if (!override || override.mode !== "custom" || !organization.allowUserOverride) {
    return base;
  }
  return {
    frequency: override.frequency ?? base.frequency,
    hour: override.hour ?? base.hour,
    weekday: override.weekday ?? base.weekday,
    dayOfMonth: override.dayOfMonth ?? base.dayOfMonth,
    timezone: override.timezone ?? base.timezone,
    categories: override.categories ?? base.categories,
    scope: override.scope ?? base.scope,
    skipIfEmpty: override.skipIfEmpty ?? base.skipIfEmpty,
    includeOwnActivity: override.includeOwnActivity ?? base.includeOwnActivity,
  };
}

/** The organization's defaults, or `ORGANIZATION_DIGEST_DEFAULTS` when unset. */
export async function loadOrganizationDigestSettings(
  db: Database,
  organizationId: string,
): Promise<OrganizationDigestSettings> {
  const row = await db.query.organizationDigestSetting.findFirst({
    where: eq(organizationDigestSetting.organizationId, organizationId),
  });
  if (!row) return ORGANIZATION_DIGEST_DEFAULTS;
  return {
    frequency: row.frequency,
    hour: row.hour,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    timezone: row.timezone,
    categories: row.categories,
    scope: row.scope,
    skipIfEmpty: row.skipIfEmpty,
    includeOwnActivity: row.includeOwnActivity,
    allowUserOverride: row.allowUserOverride,
  };
}

/** A user's stored override for one organization, or null when they have none. */
export async function loadUserDigestOverride(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<UserDigestOverride | null> {
  const row = await db.query.userDigestSetting.findFirst({
    where: and(
      eq(userDigestSetting.userId, userId),
      eq(userDigestSetting.organizationId, organizationId),
    ),
  });
  if (!row) return null;
  return {
    mode: row.mode,
    frequency: row.frequency,
    hour: row.hour,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    timezone: row.timezone,
    categories: row.categories,
    scope: row.scope,
    skipIfEmpty: row.skipIfEmpty,
    includeOwnActivity: row.includeOwnActivity,
  };
}

/** Everything needed to schedule and build one recipient's digest. */
export async function loadEffectiveDigestSettings(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<{
  organization: OrganizationDigestSettings;
  override: UserDigestOverride | null;
  effective: DigestPreferences;
}> {
  const [organization, override] = await Promise.all([
    loadOrganizationDigestSettings(db, organizationId),
    loadUserDigestOverride(db, userId, organizationId),
  ]);
  return { organization, override, effective: resolveDigestPreferences(organization, override) };
}
