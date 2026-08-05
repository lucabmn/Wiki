import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  organizationDirectNotificationSetting,
  userDirectNotificationSetting,
} from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import {
  loadEffectiveDirectSettings,
  loadOrganizationDirectSettings,
} from "../lib/notifications/direct-settings";
import {
  MyDirectSettingsSchema,
  OrganizationDirectSettingsSchema,
  UpdateMyDirectInputSchema,
  UpdateOrganizationDirectInputSchema,
} from "../schemas/inbox";

const TAGS = ["Notifications"];

/**
 * Settings for directed notifications (mentions, replies), mounted under the
 * notification router as `notifications.direct.*`.
 *
 * Same two layers as the digest settings beside it: reading the organization
 * defaults is open to every member — their own page shows what it inherits —
 * while writing them needs `organization:["update"]`.
 */
export const directNotificationRouter = {
  getOrganizationDefaults: protectedProcedure
    .route({
      method: "GET",
      path: "/notifications/direct/organization-defaults",
      tags: TAGS,
      summary: "Mention/reply defaults of the active organization",
    })
    .input(z.object({}))
    .output(OrganizationDirectSettingsSchema)
    .handler(async ({ context }) => {
      return loadOrganizationDirectSettings(context.db, requireActiveOrg(context));
    }),

  updateOrganizationDefaults: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "PUT",
      path: "/notifications/direct/organization-defaults",
      tags: TAGS,
      summary: "Update the organization's mention/reply defaults",
    })
    .input(UpdateOrganizationDirectInputSchema)
    .output(OrganizationDirectSettingsSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      // The org row is the fallback of last resort, so it must stay complete:
      // patch onto what is in force today (the row, or the built-in defaults).
      const current = await loadOrganizationDirectSettings(context.db, organizationId);
      const next = {
        mentions: input.mentions ?? current.mentions,
        commentReplies: input.commentReplies ?? current.commentReplies,
        allowUserOverride: input.allowUserOverride ?? current.allowUserOverride,
      };
      await context.db
        .insert(organizationDirectNotificationSetting)
        .values({ organizationId, ...next })
        .onConflictDoUpdate({
          target: organizationDirectNotificationSetting.organizationId,
          set: { ...next, updatedAt: new Date() },
        });
      return next;
    }),

  getMySettings: protectedProcedure
    .route({
      method: "GET",
      path: "/me/notifications/direct",
      tags: TAGS,
      summary: "The caller's mention/reply settings",
    })
    .input(z.object({}))
    .output(MyDirectSettingsSchema)
    .handler(async ({ context }) => {
      return project(context.db, context.session.user.id, requireActiveOrg(context));
    }),

  updateMySettings: protectedProcedure
    .route({
      method: "PUT",
      path: "/me/notifications/direct",
      tags: TAGS,
      summary: "Set the caller's own mention/reply settings",
    })
    .input(UpdateMyDirectInputSchema)
    .output(MyDirectSettingsSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      const defaults = await loadOrganizationDirectSettings(context.db, organizationId);
      if (!defaults.allowUserOverride) {
        throw new ORPCError("FORBIDDEN", {
          message: "Eigene Benachrichtigungseinstellungen sind in dieser Organisation deaktiviert.",
        });
      }
      // Null and undefined mean the same thing to the client ("inherit this
      // field"), and the column is nullable, so both normalise to null.
      const values = {
        mentions: input.mentions ?? null,
        commentReplies: input.commentReplies ?? null,
      };
      await context.db
        .insert(userDirectNotificationSetting)
        .values({ userId, organizationId, ...values })
        .onConflictDoUpdate({
          target: [
            userDirectNotificationSetting.userId,
            userDirectNotificationSetting.organizationId,
          ],
          set: { ...values, updatedAt: new Date() },
        });
      return project(context.db, userId, organizationId);
    }),

  resetMySettings: protectedProcedure
    .route({
      method: "DELETE",
      path: "/me/notifications/direct",
      tags: TAGS,
      summary: "Drop the caller's override and follow the organization defaults",
    })
    .input(z.object({}))
    .output(MyDirectSettingsSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      // Deleting rather than nulling every column keeps the "no row means
      // inherit" invariant true and leaves nothing stale behind.
      await context.db
        .delete(userDirectNotificationSetting)
        .where(
          and(
            eq(userDirectNotificationSetting.userId, userId),
            eq(userDirectNotificationSetting.organizationId, organizationId),
          ),
        );
      return project(context.db, userId, organizationId);
    }),
};

/** The shape every procedure above returns. */
async function project(
  db: Parameters<typeof loadEffectiveDirectSettings>[0],
  userId: string,
  organizationId: string,
) {
  const settings = await loadEffectiveDirectSettings(db, userId, organizationId);
  return { ...settings, canOverride: settings.organization.allowUserOverride };
}
