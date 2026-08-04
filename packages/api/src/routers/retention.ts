import { eq } from "drizzle-orm";
import { z } from "zod";

import { organizationRetentionSetting } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { previewRetentionImpact } from "../lib/retention/preview";
import { loadRetentionPolicy, saveRetentionPolicy } from "../lib/retention/settings";
import {
  PreviewRetentionInputSchema,
  RetentionImpactSchema,
  RetentionSettingsSchema,
  UpdateRetentionInputSchema,
} from "../schemas/retention";

const TAGS = ["Retention"];

/**
 * The organization's data-retention policy.
 *
 * Reading is open to any member — "how long is my data kept?" is a question
 * every user is entitled to ask, and hiding the answer behind an admin gate only
 * makes the product feel evasive. Writing is an admin act, and one the audit log
 * records with both the old and the new window.
 */
export const retentionRouter = {
  get: protectedProcedure
    .route({
      method: "GET",
      path: "/retention",
      tags: TAGS,
      summary: "The active organization's retention policy",
    })
    .input(z.object({}))
    .output(RetentionSettingsSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const [policy, row] = await Promise.all([
        loadRetentionPolicy(context.db, organizationId),
        context.db.query.organizationRetentionSetting.findFirst({
          where: eq(organizationRetentionSetting.organizationId, organizationId),
          columns: { lastPurgeAt: true },
        }),
      ]);
      return { ...policy, lastPurgeAt: row?.lastPurgeAt ?? null };
    }),

  preview: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "POST",
      path: "/retention/preview",
      tags: TAGS,
      summary: "How much a proposed policy would delete on the next run",
    })
    .input(PreviewRetentionInputSchema)
    .output(RetentionImpactSchema)
    .handler(async ({ input, context }) => {
      // Read-only by construction: this is the number the confirmation dialog
      // shows before an admin agrees to lose that data.
      return previewRetentionImpact(context.db, {
        organizationId: requireActiveOrg(context),
        ...input,
      });
    }),

  update: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "PUT",
      path: "/retention",
      tags: TAGS,
      summary: "Set the active organization's retention policy",
    })
    .input(UpdateRetentionInputSchema)
    .output(RetentionSettingsSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const [previous, existing] = await Promise.all([
        loadRetentionPolicy(context.db, organizationId),
        context.db.query.organizationRetentionSetting.findFirst({
          where: eq(organizationRetentionSetting.organizationId, organizationId),
          columns: { lastPurgeAt: true },
        }),
      ]);
      return context.db.transaction(async (tx) => {
        await saveRetentionPolicy(tx, organizationId, input);
        // `retention.updated` is exempt from the audit window it configures.
        // Otherwise shortening the window to a week would, a week later, erase
        // the only record of who shortened it — see PROTECTED_AUDIT_ACTIONS.
        await recordActivity(tx, {
          organizationId,
          action: "retention.updated",
          ...activityActor(context),
          metadata: { from: previous, to: input },
        });
        return { ...input, lastPurgeAt: existing?.lastPurgeAt ?? null };
      });
    }),
};
