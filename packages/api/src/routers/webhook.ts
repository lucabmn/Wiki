import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { organization, webhook, webhookDelivery } from "@nilovon-wiki/db/schema/index";

import { requireActiveOrg, requireOrgPermission } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { DELIVERABLE_ACTIONS } from "../lib/webhooks/events";
import { sendTestDelivery } from "../lib/webhooks/run";
import { generateWebhookSecret, webhookSecretPreview } from "../lib/webhooks/signature";
import { checkWebhookHostname } from "../lib/webhooks/url";
import {
  CreatedWebhookSchema,
  CreateWebhookInputSchema,
  ListDeliveriesInputSchema,
  TestWebhookResultSchema,
  UpdateWebhookInputSchema,
  WebhookDeliverySchema,
  WebhookSchema,
} from "../schemas/webhook";
import { ActivityActionSchema } from "../schemas/misc";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Webhooks"];

/**
 * Outbound webhook subscriptions.
 *
 * Every procedure needs `organization:["update"]` — the same right that gates
 * the rest of the organization settings. A webhook exports events to a system
 * this one cannot see, so configuring one is an organization-level decision, not
 * a per-space one, even when the subscription itself is scoped to a space.
 *
 * Tenant isolation is not left to the id being unguessable: every lookup filters
 * on the caller's active organization, so a foreign id reads as NOT_FOUND.
 */
export const webhookRouter = {
  listEvents: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "GET",
      path: "/webhooks/events",
      tags: TAGS,
      summary: "Actions a webhook can subscribe to",
    })
    .input(z.object({}))
    .output(z.array(ActivityActionSchema))
    .handler(() => [...DELIVERABLE_ACTIONS]),

  list: requireOrgPermission({ organization: ["update"] })
    .route({ method: "GET", path: "/webhooks", tags: TAGS, summary: "List webhooks" })
    .input(z.object({}))
    .output(z.array(WebhookSchema))
    .handler(({ context }) => listWebhooks(context.db, requireActiveOrg(context))),

  create: requireOrgPermission({ organization: ["update"] })
    .route({ method: "POST", path: "/webhooks", tags: TAGS, summary: "Create a webhook" })
    .input(CreateWebhookInputSchema)
    .output(CreatedWebhookSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      assertDeliverableUrl(input.url);
      const secret = generateWebhookSecret();

      const created = await context.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(webhook)
          .values({
            organizationId,
            name: input.name,
            url: input.url,
            secret,
            events: input.events,
            spaceId: input.spaceId ?? null,
            active: input.active,
            createdBy: context.session.user.id,
          })
          .returning();
        if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
        await recordActivity(tx, {
          organizationId,
          action: "webhook.created",
          ...activityActor(context),
          metadata: { webhookId: row.id, name: row.name, url: row.url, spaceId: row.spaceId },
        });
        return row;
      });

      const [projected] = await listWebhooks(context.db, organizationId, created.id);
      // The one and only time the secret leaves the server. It is stored to sign
      // with, not to be read back — `list` returns a prefix from here on.
      return { ...projected!, secret };
    }),

  update: requireOrgPermission({ organization: ["update"] })
    .route({ method: "PATCH", path: "/webhooks/{id}", tags: TAGS, summary: "Update a webhook" })
    .input(UpdateWebhookInputSchema)
    .output(WebhookSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await loadWebhook(context.db, input.id, organizationId);
      const { id, spaceId, ...patch } = input;
      if (patch.url) assertDeliverableUrl(patch.url);

      const values = {
        ...patch,
        // `undefined` leaves the scope alone; an explicit null widens the
        // webhook to the whole organization.
        ...(spaceId === undefined ? {} : { spaceId: spaceId ?? null }),
      };

      await context.db.transaction(async (tx) => {
        if (Object.keys(values).length > 0) {
          await tx.update(webhook).set(values).where(eq(webhook.id, id));
        }
        await recordActivity(tx, {
          organizationId,
          action: "webhook.updated",
          ...activityActor(context),
          metadata: {
            webhookId: id,
            name: values.name ?? existing.name,
            changed: Object.keys(values),
          },
        });
      });

      const [projected] = await listWebhooks(context.db, organizationId, id);
      return projected!;
    }),

  delete: requireOrgPermission({ organization: ["update"] })
    .route({ method: "DELETE", path: "/webhooks/{id}", tags: TAGS, summary: "Delete a webhook" })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await loadWebhook(context.db, input.id, organizationId);
      return context.db.transaction(async (tx) => {
        await tx.delete(webhook).where(eq(webhook.id, existing.id));
        await recordActivity(tx, {
          organizationId,
          action: "webhook.deleted",
          ...activityActor(context),
          // The endpoint is gone from the table after this, so the audit row is
          // the only remaining record of where events used to be sent.
          metadata: { webhookId: existing.id, name: existing.name, url: existing.url },
        });
        return { id: existing.id };
      });
    }),

  test: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "POST",
      path: "/webhooks/{id}/test",
      tags: TAGS,
      summary: "Send a one-off ping to the endpoint",
    })
    .input(z.object({ id: IdSchema }))
    .output(TestWebhookResultSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const target = await loadWebhook(context.db, input.id, organizationId);
      const org = await context.db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
        columns: { id: true, name: true },
      });

      const delivery = await sendTestDelivery(context.db, {
        webhook: target,
        organization: { id: organizationId, name: org?.name ?? "" },
        actor: { id: context.session.user.id, name: context.session.user.name ?? "" },
      });
      return {
        ok: delivery.status === "delivered",
        responseStatus: delivery.responseStatus,
        error: delivery.lastError,
      };
    }),

  listDeliveries: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "GET",
      path: "/webhooks/{webhookId}/deliveries",
      tags: TAGS,
      summary: "Recent delivery attempts, including failures",
    })
    .input(ListDeliveriesInputSchema)
    .output(z.array(WebhookDeliverySchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      await loadWebhook(context.db, input.webhookId, organizationId);

      const rows = await context.db.query.webhookDelivery.findMany({
        where: eq(webhookDelivery.webhookId, input.webhookId),
        orderBy: [desc(webhookDelivery.createdAt)],
        limit: input.limit,
        with: { activity: { columns: { action: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        webhookId: row.webhookId,
        event: row.activity?.action ?? null,
        status: row.status,
        attempts: row.attempts,
        responseStatus: row.responseStatus,
        lastError: row.lastError,
        nextAttemptAt: row.nextAttemptAt,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
      }));
    }),
};

/** Loads one webhook of *this* organization, or 404s. */
async function loadWebhook(db: Database, id: string, organizationId: string) {
  const row = await db.query.webhook.findFirst({
    where: and(eq(webhook.id, id), eq(webhook.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Webhook nicht gefunden" });
  return row;
}

/**
 * Rejects internal targets at save time. The runner checks again against the
 * resolved addresses — this one exists so the admin sees the reason in the
 * dialog instead of a failed delivery ten seconds later.
 */
function assertDeliverableUrl(url: string): void {
  const check = checkWebhookHostname(url);
  if (!check.ok) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${check.reason} Webhooks dürfen nur öffentlich erreichbare Adressen ansprechen.`,
    });
  }
}

/** The list projection, shared by every procedure that returns a webhook. */
async function listWebhooks(db: Database, organizationId: string, id?: string) {
  const rows = await db.query.webhook.findMany({
    where: id
      ? and(eq(webhook.organizationId, organizationId), eq(webhook.id, id))
      : eq(webhook.organizationId, organizationId),
    orderBy: [desc(webhook.createdAt)],
    with: { space: { columns: { name: true } } },
  });
  if (rows.length === 0) return [];

  // One row per webhook — `DISTINCT ON` keeps the newest attempt without
  // dragging the whole delivery history into memory to sort it here.
  const latest = await db
    .selectDistinctOn([webhookDelivery.webhookId], {
      webhookId: webhookDelivery.webhookId,
      status: webhookDelivery.status,
      responseStatus: webhookDelivery.responseStatus,
      lastError: webhookDelivery.lastError,
      createdAt: webhookDelivery.createdAt,
    })
    .from(webhookDelivery)
    .where(
      inArray(
        webhookDelivery.webhookId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(webhookDelivery.webhookId, desc(webhookDelivery.createdAt));
  const byWebhook = new Map(latest.map((row) => [row.webhookId, row]));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    spaceId: row.spaceId,
    spaceName: row.space?.name ?? null,
    active: row.active,
    secretPreview: webhookSecretPreview(row.secret),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDelivery: byWebhook.get(row.id)
      ? {
          status: byWebhook.get(row.id)!.status,
          responseStatus: byWebhook.get(row.id)!.responseStatus,
          lastError: byWebhook.get(row.id)!.lastError,
          createdAt: byWebhook.get(row.id)!.createdAt,
        }
      : null,
  }));
}
