import { z } from "zod";

import { IdSchema } from "./shared";

export const TwoFactorPolicySchema = z.object({
  twoFactorRequired: z.boolean(),
  /** Null means the requirement bites immediately. */
  twoFactorGraceUntil: z.date().nullable(),
  twoFactorRequireForSso: z.boolean(),
});

/**
 * A full replacement rather than a patch: the three fields are one decision
 * ("who has to have a second factor, by when"), and a partial update makes it
 * possible to turn the requirement on while leaving a stale grace date behind.
 */
export const UpdateTwoFactorPolicyInputSchema = z.object({
  twoFactorRequired: z.boolean(),
  twoFactorGraceUntil: z.coerce.date().nullable().default(null),
  twoFactorRequireForSso: z.boolean().default(false),
});

export const MemberComplianceSchema = z.object({
  userId: IdSchema,
  name: z.string(),
  email: z.string(),
  hasSecondFactor: z.boolean(),
  isSsoAccount: z.boolean(),
});

/**
 * The admin screen's whole payload. The member list is what makes the switch
 * flippable: without "these 12 people would lose access tomorrow", nobody dares
 * turn it on.
 */
export const TwoFactorPolicyOverviewSchema = z.object({
  policy: TwoFactorPolicySchema,
  memberCount: z.number().int(),
  /**
   * Every member without a second factor, SSO accounts included and flagged as
   * such. Deliberately unfiltered: the screen previews the consequences of the
   * *unsaved* form, so it has to be able to re-apply the SSO exemption itself.
   */
  nonCompliant: z.array(MemberComplianceSchema),
  /** False when SMTP is unset: the warning mails would silently go nowhere. */
  mailConfigured: z.boolean(),
});

export const MyTwoFactorStatusSchema = z.object({
  status: z.enum(["ok", "grace", "blocked"]),
  required: z.boolean(),
  graceUntil: z.date().nullable(),
  hasSecondFactor: z.boolean(),
  exemptAsSso: z.boolean(),
});
