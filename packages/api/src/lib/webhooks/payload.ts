import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { activity } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { pageHref } from "../page-href";

/**
 * The delivered JSON body.
 *
 * Enriched rather than ID-only, deliberately: there is no API-key surface in
 * this product yet (`context.ts` knows session cookies and nothing else), so a
 * receiver handed bare IDs could not resolve them into anything a human wants to
 * read. What is included is exactly what a Slack message or a Jira comment
 * needs — names, titles, a link. What is *not* included is page content: the
 * receiver is outside the permission system, and a webhook must not become a way
 * to read a private space.
 */
export type WebhookEventPayload = {
  /** Delivery id. Stable across retries — a receiver can use it to deduplicate. */
  id: string;
  event: string;
  /** ISO-8601, in UTC. When the event happened, not when it was sent. */
  at: string;
  organization: { id: string; name: string };
  actor: { id: string; name: string } | null;
  space: { id: string; slug: string; name: string } | null;
  page: { id: string; slug: string; title: string; url: string } | null;
  /** Action-specific context from the audit row, passed through verbatim. */
  metadata: unknown;
};

const webUrl = (): string => env.CORS_ORIGIN.replace(/\/+$/, "");

/**
 * Renders the payload for one queued delivery, or null if the audit row is gone
 * (a pruned log) and there is nothing left to report.
 *
 * Rendering happens at send time, not at enqueue time: queued rows then survive
 * a change to this shape, and a retry three hours later still carries the names
 * the resources have now rather than a stale copy.
 */
export async function buildEventPayload(
  db: Database,
  input: { deliveryId: string; activityId: string },
): Promise<WebhookEventPayload | null> {
  const row = await db.query.activity.findFirst({
    where: eq(activity.id, input.activityId),
    with: {
      organization: { columns: { id: true, name: true } },
      space: { columns: { id: true, slug: true, name: true } },
      page: { columns: { id: true, slug: true, title: true } },
      actor: { columns: { id: true, name: true } },
    },
  });
  if (!row) return null;

  return {
    id: input.deliveryId,
    event: row.action,
    at: row.createdAt.toISOString(),
    organization: { id: row.organizationId, name: row.organization?.name ?? "" },
    actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
    space: row.space ? { id: row.space.id, slug: row.space.slug, name: row.space.name } : null,
    page: row.page
      ? {
          id: row.page.id,
          slug: row.page.slug,
          title: row.page.title,
          url: `${webUrl()}${pageHref(row.page.id)}`,
        }
      : null,
    metadata: row.metadata ?? null,
  };
}

/**
 * The payload of the "Test senden" button. Same envelope as a real event so a
 * receiver's parser is exercised, with an event name no real activity uses.
 */
export function buildPingPayload(input: {
  deliveryId: string;
  organization: { id: string; name: string };
  actor: { id: string; name: string } | null;
  at: Date;
}): WebhookEventPayload {
  return {
    id: input.deliveryId,
    event: "ping",
    at: input.at.toISOString(),
    organization: input.organization,
    actor: input.actor,
    space: null,
    page: null,
    metadata: { message: "Testereignis aus den Wiki-Einstellungen." },
  };
}
