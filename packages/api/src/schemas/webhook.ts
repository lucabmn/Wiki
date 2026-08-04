import { z } from "zod";

import { isDeliverableAction } from "../lib/webhooks/events";
import { ActivityActionSchema } from "./misc";
import { ExternalUrlSchema } from "./external-link";
import { IdSchema } from "./shared";

/**
 * Only actions a receiver may subscribe to. `webhook.*` is audited but not
 * deliverable (it would feed back into itself), so it is refused here rather
 * than silently dropped at fan-out time — an admin who ticks it deserves to be
 * told why nothing arrives.
 */
export const WebhookEventSchema = ActivityActionSchema.refine(isDeliverableAction, {
  message: "Dieses Ereignis kann nicht abonniert werden.",
});

const NameSchema = z.string().trim().min(1).max(80);
const EventsSchema = z
  .array(WebhookEventSchema)
  .min(1, "Mindestens ein Ereignis auswählen.")
  .max(64)
  // A duplicate in the list would deliver the same event twice.
  .transform((events) => [...new Set(events)]);

/** The last attempt, so the list can show health without a second round-trip. */
export const WebhookDeliverySummarySchema = z.object({
  status: z.enum(["pending", "delivered", "failed"]),
  responseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
});

export const WebhookSchema = z.object({
  id: IdSchema,
  name: z.string(),
  url: z.string(),
  // Unrefined on the way out: a stored row is reported as it is, even if the
  // deliverable set later shrinks. The refinement guards writes, not reads.
  events: z.array(ActivityActionSchema),
  spaceId: IdSchema.nullable(),
  spaceName: z.string().nullable(),
  active: z.boolean(),
  /** Never the secret itself — only enough to tell two of them apart. */
  secretPreview: z.string(),
  createdBy: IdSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastDelivery: WebhookDeliverySummarySchema.nullable(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

/**
 * `create` is the only place the secret is ever readable. It is not recoverable
 * afterwards — a lost secret is replaced by rotating, not by looking it up.
 */
export const CreatedWebhookSchema = WebhookSchema.extend({ secret: z.string() });

export const CreateWebhookInputSchema = z.object({
  name: NameSchema,
  url: ExternalUrlSchema,
  events: EventsSchema,
  /** Null or omitted = every space in the organization, including future ones. */
  spaceId: IdSchema.nullish(),
  active: z.boolean().default(true),
});

export const UpdateWebhookInputSchema = z.object({
  id: IdSchema,
  name: NameSchema.optional(),
  url: ExternalUrlSchema.optional(),
  events: EventsSchema.optional(),
  spaceId: IdSchema.nullish(),
  active: z.boolean().optional(),
});

export const WebhookDeliverySchema = z.object({
  id: IdSchema,
  webhookId: IdSchema,
  /** Null for the manual test ping, which has no audit row behind it. */
  event: z.string().nullable(),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number().int(),
  responseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.date().nullable(),
  deliveredAt: z.date().nullable(),
  createdAt: z.date(),
});

export const ListDeliveriesInputSchema = z.object({
  webhookId: IdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const TestWebhookResultSchema = z.object({
  ok: z.boolean(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
});
