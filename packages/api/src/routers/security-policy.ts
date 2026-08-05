import { eq } from "drizzle-orm";
import { z } from "zod";

import { isMailConfigured } from "@nilovon-wiki/auth/mail";
import { organization } from "@nilovon-wiki/db/schema/index";

import { requireActiveOrg, requireOrgPermission, sessionProcedure } from "../index";
import { recordActivity, type ActivityAction } from "../lib/activity";
import {
  loadOrganizationSettings,
  saveOrganizationSettings,
  type OrganizationSettings,
} from "../lib/organization-settings";
import {
  affectedMembers,
  evaluateTwoFactorPolicy,
  listMemberCompliance,
} from "../lib/two-factor-policy";
import { sendTwoFactorPolicyMails } from "../lib/two-factor-policy-mail";
import {
  MyTwoFactorStatusSchema,
  TwoFactorPolicyOverviewSchema,
  UpdateTwoFactorPolicyInputSchema,
} from "../schemas/security-policy";

const TAGS = ["Security"];

/**
 * Organisation-wide security policy. Reading and writing both need
 * `organization:["update"]` — unlike the notification defaults, the member
 * compliance list is not something a plain member should be able to enumerate,
 * since it names exactly who is the easiest account to take over.
 *
 * `getMyTwoFactorStatus` is the deliberate exception: it is built on
 * `sessionProcedure`, because a blocked user has to be able to render the
 * screen that tells them why they are blocked.
 */
export const securityPolicyRouter = {
  getTwoFactorPolicy: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "GET",
      path: "/security/two-factor-policy",
      tags: TAGS,
      summary: "Two-factor policy of the active organization, with member compliance",
    })
    .input(z.object({}))
    .output(TwoFactorPolicyOverviewSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const [policy, members] = await Promise.all([
        loadOrganizationSettings(context.db, organizationId),
        listMemberCompliance(context.db, organizationId),
      ]);
      return buildOverview(policy, members);
    }),

  updateTwoFactorPolicy: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "PUT",
      path: "/security/two-factor-policy",
      tags: TAGS,
      summary: "Set the two-factor requirement, its grace period and the SSO exemption",
    })
    .input(UpdateTwoFactorPolicyInputSchema)
    .output(TwoFactorPolicyOverviewSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const before = await loadOrganizationSettings(context.db, organizationId);
      const after: OrganizationSettings = {
        twoFactorRequired: input.twoFactorRequired,
        // A grace date on a switched-off requirement is dead state that would
        // resurrect the moment someone flips the switch back on.
        twoFactorGraceUntil: input.twoFactorRequired ? input.twoFactorGraceUntil : null,
        twoFactorRequireForSso: input.twoFactorRequireForSso,
      };

      const members = await listMemberCompliance(context.db, organizationId);
      const affected = affectedMembers(members, after);

      await context.db.transaction(async (tx) => {
        await saveOrganizationSettings(tx, organizationId, after);
        const action = auditAction(before, after);
        if (action) {
          await recordActivity(tx, {
            organizationId,
            action,
            actorId: context.session.user.id,
            metadata: {
              before: serialize(before),
              after: serialize(after),
              affectedMembers: affected.length,
            },
          });
        }
      });

      // Only on activation, and only to the people it will actually lock out.
      // Re-saving an already-active policy must not re-mail everyone.
      if (after.twoFactorRequired && !before.twoFactorRequired) {
        const org = await context.db.query.organization.findFirst({
          columns: { name: true },
          where: eq(organization.id, organizationId),
        });
        await sendTwoFactorPolicyMails({
          members: affected,
          organizationName: org?.name ?? "Wiki",
          graceUntil: after.twoFactorGraceUntil,
        });
      }

      return buildOverview(after, members);
    }),

  getMyTwoFactorStatus: sessionProcedure
    .route({
      method: "GET",
      path: "/me/two-factor-status",
      tags: TAGS,
      summary: "Whether the caller satisfies their organization's two-factor policy",
    })
    .input(z.object({}))
    .output(MyTwoFactorStatusSchema)
    .handler(async ({ context }) => {
      const organizationId = context.session.session.activeOrganizationId;
      if (!organizationId) {
        return {
          status: "ok" as const,
          required: false,
          graceUntil: null,
          hasSecondFactor: false,
          exemptAsSso: false,
        };
      }
      const state = await evaluateTwoFactorPolicy(context.db, {
        userId: context.session.user.id,
        organizationId,
      });
      return {
        status: state.status,
        required: state.required,
        graceUntil: state.graceUntil,
        hasSecondFactor: state.hasSecondFactor,
        exemptAsSso: state.exemptAsSso,
      };
    }),
};

function buildOverview(
  policy: OrganizationSettings,
  members: Awaited<ReturnType<typeof listMemberCompliance>>,
) {
  return {
    policy,
    memberCount: members.length,
    nonCompliant: members.filter((entry) => !entry.hasSecondFactor),
    mailConfigured: isMailConfigured(),
  };
}

/**
 * Which audit row this edit deserves, or null when nothing changed.
 *
 * An edit that leaves the requirement switched on is recorded as
 * `…grace_updated` whatever moved — the grace date is the field that changes in
 * practice, and the metadata carries the full before/after either way.
 */
function auditAction(
  before: OrganizationSettings,
  after: OrganizationSettings,
): ActivityAction | null {
  if (before.twoFactorRequired !== after.twoFactorRequired) {
    return after.twoFactorRequired
      ? "organization.two_factor_enabled"
      : "organization.two_factor_disabled";
  }
  if (!after.twoFactorRequired) return null;
  const changed =
    before.twoFactorGraceUntil?.getTime() !== after.twoFactorGraceUntil?.getTime() ||
    before.twoFactorRequireForSso !== after.twoFactorRequireForSso;
  return changed ? "organization.two_factor_grace_updated" : null;
}

/** Dates go into `jsonb` as ISO strings so the audit row stays readable. */
function serialize(settings: OrganizationSettings) {
  return {
    twoFactorRequired: settings.twoFactorRequired,
    twoFactorGraceUntil: settings.twoFactorGraceUntil?.toISOString() ?? null,
    twoFactorRequireForSso: settings.twoFactorRequireForSso,
  };
}
