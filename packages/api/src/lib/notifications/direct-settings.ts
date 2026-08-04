import { and, eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  organizationDirectNotificationSetting,
  userDirectNotificationSetting,
} from "@nilovon-wiki/db/schema/index";

/**
 * Who wants to hear about being named. Mirrors the digest settings' two-layer
 * shape (`./settings.ts`): the organization row is complete, a user row is
 * sparse, and no user row at all means "follow the defaults, including later
 * changes to them".
 */
export type DirectNotificationPreferences = {
  mentions: boolean;
  commentReplies: boolean;
};

export type OrganizationDirectNotificationSettings = DirectNotificationPreferences & {
  allowUserOverride: boolean;
};

/** A user's stored override — `null` on every field they did not customise. */
export type UserDirectNotificationOverride = {
  [K in keyof DirectNotificationPreferences]: DirectNotificationPreferences[K] | null;
};

/**
 * Fallback for an organization that has no row yet. Must mirror the column
 * defaults, so an org behaves the same before and after an admin first saves.
 */
export const ORGANIZATION_DIRECT_NOTIFICATION_DEFAULTS: OrganizationDirectNotificationSettings = {
  mentions: true,
  commentReplies: true,
  allowUserOverride: true,
};

/** Folds a user's override onto the organization defaults, field by field. */
export function resolveDirectNotificationPreferences(
  organization: OrganizationDirectNotificationSettings,
  override: UserDirectNotificationOverride | null,
): DirectNotificationPreferences {
  const base: DirectNotificationPreferences = {
    mentions: organization.mentions,
    commentReplies: organization.commentReplies,
  };
  if (!override || !organization.allowUserOverride) return base;
  return {
    mentions: override.mentions ?? base.mentions,
    commentReplies: override.commentReplies ?? base.commentReplies,
  };
}

export async function loadOrganizationDirectSettings(
  db: Database,
  organizationId: string,
): Promise<OrganizationDirectNotificationSettings> {
  const row = await db.query.organizationDirectNotificationSetting.findFirst({
    where: eq(organizationDirectNotificationSetting.organizationId, organizationId),
  });
  if (!row) return ORGANIZATION_DIRECT_NOTIFICATION_DEFAULTS;
  return {
    mentions: row.mentions,
    commentReplies: row.commentReplies,
    allowUserOverride: row.allowUserOverride,
  };
}

export async function loadUserDirectOverride(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<UserDirectNotificationOverride | null> {
  const row = await db.query.userDirectNotificationSetting.findFirst({
    where: and(
      eq(userDirectNotificationSetting.userId, userId),
      eq(userDirectNotificationSetting.organizationId, organizationId),
    ),
  });
  if (!row) return null;
  return { mentions: row.mentions, commentReplies: row.commentReplies };
}

/** The organization defaults, the caller's override, and the result of folding. */
export async function loadEffectiveDirectSettings(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<{
  organization: OrganizationDirectNotificationSettings;
  override: UserDirectNotificationOverride | null;
  effective: DirectNotificationPreferences;
}> {
  const [organization, override] = await Promise.all([
    loadOrganizationDirectSettings(db, organizationId),
    loadUserDirectOverride(db, userId, organizationId),
  ]);
  return {
    organization,
    override,
    effective: resolveDirectNotificationPreferences(organization, override),
  };
}

/**
 * Batched variant for delivery, which resolves several recipients at once and
 * would otherwise issue two queries per person.
 */
export async function loadPreferencesFor(
  db: Database,
  userIds: string[],
  organizationId: string,
): Promise<Map<string, DirectNotificationPreferences>> {
  const organization = await loadOrganizationDirectSettings(db, organizationId);
  const overrides = organization.allowUserOverride
    ? await db.query.userDirectNotificationSetting.findMany({
        where: eq(userDirectNotificationSetting.organizationId, organizationId),
      })
    : [];
  const byUser = new Map(overrides.map((row) => [row.userId, row]));
  return new Map(
    userIds.map((userId) => [
      userId,
      resolveDirectNotificationPreferences(organization, byUser.get(userId) ?? null),
    ]),
  );
}
