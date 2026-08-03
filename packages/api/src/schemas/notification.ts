import { z } from "zod";

import { isValidTimeZone, MAX_DAY_OF_MONTH } from "../lib/notifications/schedule";
import { ActivityActionSchema } from "./misc";
import { IdSchema } from "./shared";

export const DigestFrequencySchema = z.enum(["off", "daily", "weekly", "monthly"]);
export const DigestScopeSchema = z.enum(["organization", "my_spaces", "subscribed"]);
export const DigestModeSchema = z.enum(["inherit", "custom"]);
export const DigestCategorySchema = z.enum([
  "pages_created",
  "pages_updated",
  "pages_removed",
  "comments",
  "attachments",
  "spaces",
]);

// Validated against the runtime's own IANA database rather than a hardcoded
// list: the list would rot, and a zone the server cannot resolve would silently
// fall back to UTC at send time instead of being rejected here.
const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unbekannte Zeitzone" });

const preferenceFields = {
  frequency: DigestFrequencySchema,
  /** Local hour of day the digest goes out. */
  hour: z.number().int().min(0).max(23),
  /** 0 = Sunday … 6 = Saturday. Only read by weekly schedules. */
  weekday: z.number().int().min(0).max(6),
  /** Capped at 28 so a monthly digest never skips February. */
  dayOfMonth: z.number().int().min(1).max(MAX_DAY_OF_MONTH),
  timezone: TimezoneSchema,
  categories: z.array(DigestCategorySchema).max(6),
  scope: DigestScopeSchema,
  skipIfEmpty: z.boolean(),
  includeOwnActivity: z.boolean(),
};

export const DigestPreferencesSchema = z.object(preferenceFields);

export const OrganizationDigestSettingsSchema = DigestPreferencesSchema.extend({
  allowUserOverride: z.boolean(),
});

/** Every field optional: an admin form may patch one switch. */
export const UpdateOrganizationDigestInputSchema = OrganizationDigestSettingsSchema.partial();

/** A user's stored override — `null` on a field means "inherit that one". */
export const UserDigestOverrideSchema = z.object({
  mode: DigestModeSchema,
  frequency: DigestFrequencySchema.nullable(),
  hour: preferenceFields.hour.nullable(),
  weekday: preferenceFields.weekday.nullable(),
  dayOfMonth: preferenceFields.dayOfMonth.nullable(),
  timezone: TimezoneSchema.nullable(),
  categories: preferenceFields.categories.nullable(),
  scope: DigestScopeSchema.nullable(),
  skipIfEmpty: z.boolean().nullable(),
  includeOwnActivity: z.boolean().nullable(),
});

export const UpdateMyDigestInputSchema = z.object({
  mode: DigestModeSchema,
  frequency: DigestFrequencySchema.nullish(),
  hour: preferenceFields.hour.nullish(),
  weekday: preferenceFields.weekday.nullish(),
  dayOfMonth: preferenceFields.dayOfMonth.nullish(),
  timezone: TimezoneSchema.nullish(),
  categories: preferenceFields.categories.nullish(),
  scope: DigestScopeSchema.nullish(),
  skipIfEmpty: z.boolean().nullish(),
  includeOwnActivity: z.boolean().nullish(),
});

export const MyDigestSettingsSchema = z.object({
  /** The admin defaults, shown alongside so the UI can label what is inherited. */
  organization: OrganizationDigestSettingsSchema,
  override: UserDigestOverrideSchema.nullable(),
  /** What will actually be used — defaults folded with the override. */
  effective: DigestPreferencesSchema,
  nextRunAt: z.date().nullable(),
  lastSentAt: z.date().nullable(),
  /** False when the admin has locked the organization defaults. */
  canOverride: z.boolean(),
  /** False when the server has no SMTP configured — nothing will be delivered. */
  mailConfigured: z.boolean(),
});

export const DigestPreviewEntrySchema = z.object({
  id: IdSchema,
  action: ActivityActionSchema,
  category: DigestCategorySchema,
  createdAt: z.date(),
  actorName: z.string().nullable(),
  spaceId: IdSchema.nullable(),
  spaceName: z.string().nullable(),
  pageId: IdSchema.nullable(),
  title: z.string().nullable(),
});

export const DigestPreviewSchema = z.object({
  from: z.date(),
  to: z.date(),
  entries: z.array(DigestPreviewEntrySchema),
  truncated: z.number().int().min(0),
});
