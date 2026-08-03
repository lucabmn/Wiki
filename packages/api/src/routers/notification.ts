import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { isMailConfigured } from "@nilovon-wiki/auth/mail";
import {
  digestDelivery,
  organizationDigestSetting,
  userDigestSetting,
} from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { collectDigest } from "../lib/notifications/collect";
import { rescheduleDigest, rescheduleOrganizationDigests } from "../lib/notifications/run";
import {
  loadEffectiveDigestSettings,
  loadOrganizationDigestSettings,
  ORGANIZATION_DIGEST_DEFAULTS,
} from "../lib/notifications/settings";
import {
  DigestPreviewSchema,
  MyDigestSettingsSchema,
  OrganizationDigestSettingsSchema,
  UpdateMyDigestInputSchema,
  UpdateOrganizationDigestInputSchema,
} from "../schemas/notification";

const TAGS = ["Notifications"];

/** Window a preview covers when the caller has never received a digest. */
const PREVIEW_FALLBACK_DAYS = 7;

/**
 * Bundled ("digest") notification settings.
 *
 * Two layers: an admin sets the organization defaults, and every member may
 * keep them or set their own. Reading the defaults is open to all members —
 * the personal settings page shows what it is inheriting — while writing them
 * needs `organization:["update"]`, the same right that gates the rest of the
 * organization settings area.
 */
export const notificationRouter = {
  getOrganizationDefaults: protectedProcedure
    .route({
      method: "GET",
      path: "/notifications/organization-defaults",
      tags: TAGS,
      summary: "Digest defaults of the active organization",
    })
    .input(z.object({}))
    .output(OrganizationDigestSettingsSchema)
    .handler(async ({ context }) => {
      return loadOrganizationDigestSettings(context.db, requireActiveOrg(context));
    }),

  updateOrganizationDefaults: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "PUT",
      path: "/notifications/organization-defaults",
      tags: TAGS,
      summary: "Update the organization's digest defaults",
    })
    .input(UpdateOrganizationDigestInputSchema)
    .output(OrganizationDigestSettingsSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const current = await loadOrganizationDigestSettings(context.db, organizationId);
      // The org row is the fallback of last resort, so it must be complete:
      // patch onto what is in force today (the row, or the built-in defaults).
      const next = { ...current, ...stripUndefined(input) };

      await context.db
        .insert(organizationDigestSetting)
        .values({ organizationId, ...next })
        .onConflictDoUpdate({
          target: organizationDigestSetting.organizationId,
          set: { ...next, updatedAt: new Date() },
        });

      // Everyone inheriting these defaults moves onto the new schedule now,
      // rather than after one more run of the old one.
      await rescheduleOrganizationDigests(context.db, organizationId);
      return next;
    }),

  getMySettings: protectedProcedure
    .route({
      method: "GET",
      path: "/me/notifications",
      tags: TAGS,
      summary: "The caller's digest settings, defaults and next send",
    })
    .input(z.object({}))
    .output(MyDigestSettingsSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      const [settings, delivery] = await Promise.all([
        loadEffectiveDigestSettings(context.db, userId, organizationId),
        context.db.query.digestDelivery.findFirst({
          where: and(
            eq(digestDelivery.userId, userId),
            eq(digestDelivery.organizationId, organizationId),
          ),
        }),
      ]);
      return {
        organization: settings.organization,
        override: settings.override,
        effective: settings.effective,
        nextRunAt: delivery?.nextRunAt ?? null,
        lastSentAt: delivery?.lastSentAt ?? null,
        canOverride: settings.organization.allowUserOverride,
        mailConfigured: isMailConfigured(),
      };
    }),

  updateMySettings: protectedProcedure
    .route({
      method: "PUT",
      path: "/me/notifications",
      tags: TAGS,
      summary: "Set the caller's own digest settings",
    })
    .input(UpdateMyDigestInputSchema)
    .output(MyDigestSettingsSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;

      const defaults = await loadOrganizationDigestSettings(context.db, organizationId);
      if (!defaults.allowUserOverride && input.mode === "custom") {
        throw new ORPCError("FORBIDDEN", {
          message: "Eigene Benachrichtigungseinstellungen sind in dieser Organisation deaktiviert.",
        });
      }

      // Null and undefined mean the same thing to the client ("inherit this
      // field"), and the column is nullable, so both normalise to null.
      const values = {
        mode: input.mode,
        frequency: input.frequency ?? null,
        hour: input.hour ?? null,
        weekday: input.weekday ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        timezone: input.timezone ?? null,
        categories: input.categories ?? null,
        scope: input.scope ?? null,
        skipIfEmpty: input.skipIfEmpty ?? null,
        includeOwnActivity: input.includeOwnActivity ?? null,
      };

      await context.db
        .insert(userDigestSetting)
        .values({ userId, organizationId, ...values })
        .onConflictDoUpdate({
          target: [userDigestSetting.userId, userDigestSetting.organizationId],
          set: { ...values, updatedAt: new Date() },
        });

      await rescheduleDigest(context.db, userId, organizationId);
      return readMySettings(context.db, userId, organizationId);
    }),

  resetMySettings: protectedProcedure
    .route({
      method: "DELETE",
      path: "/me/notifications",
      tags: TAGS,
      summary: "Drop the caller's override and follow the organization defaults",
    })
    .input(z.object({}))
    .output(MyDigestSettingsSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      // Deleting rather than switching to `inherit` keeps the "no row means
      // inherit" invariant true and leaves nothing stale behind.
      await context.db
        .delete(userDigestSetting)
        .where(
          and(
            eq(userDigestSetting.userId, userId),
            eq(userDigestSetting.organizationId, organizationId),
          ),
        );
      await rescheduleDigest(context.db, userId, organizationId);
      return readMySettings(context.db, userId, organizationId);
    }),

  previewMyDigest: protectedProcedure
    .route({
      method: "GET",
      path: "/me/notifications/preview",
      tags: TAGS,
      summary: "What the caller's next digest would contain right now",
    })
    .input(z.object({}))
    .output(DigestPreviewSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      const now = new Date();

      const [{ effective }, delivery] = await Promise.all([
        loadEffectiveDigestSettings(context.db, userId, organizationId),
        context.db.query.digestDelivery.findFirst({
          where: and(
            eq(digestDelivery.userId, userId),
            eq(digestDelivery.organizationId, organizationId),
          ),
        }),
      ]);

      const from =
        delivery?.cursorAt ?? new Date(now.getTime() - PREVIEW_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
      const content = await collectDigest(context.db, {
        userId,
        organizationId,
        preferences: effective,
        from,
        to: now,
      });
      return { from, to: now, ...content };
    }),
};

/** Undefined keys must not overwrite stored values with `undefined`. */
function stripUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** The `getMySettings` projection, reused by the mutations' return value. */
async function readMySettings(
  db: Parameters<typeof loadEffectiveDigestSettings>[0],
  userId: string,
  organizationId: string,
) {
  const [settings, delivery] = await Promise.all([
    loadEffectiveDigestSettings(db, userId, organizationId),
    db.query.digestDelivery.findFirst({
      where: and(
        eq(digestDelivery.userId, userId),
        eq(digestDelivery.organizationId, organizationId),
      ),
    }),
  ]);
  return {
    organization: settings.organization,
    override: settings.override,
    effective: settings.effective,
    nextRunAt: delivery?.nextRunAt ?? null,
    lastSentAt: delivery?.lastSentAt ?? null,
    canOverride: settings.organization.allowUserOverride,
    mailConfigured: isMailConfigured(),
  };
}

// Re-exported so callers can render the same fallback the server uses before an
// admin has ever saved the organization defaults.
export { ORGANIZATION_DIGEST_DEFAULTS };
