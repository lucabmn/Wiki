import { env } from "@nilovon-wiki/env/server";

import type { WebhookEventPayload } from "./payload";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signWebhookPayload } from "./signature";
import { checkWebhookTarget } from "./url";

export type DeliveryAttempt = {
  ok: boolean;
  /** HTTP status, or null when the request never produced a response. */
  responseStatus: number | null;
  /** Short, human-readable failure reason; null on success. */
  error: string | null;
};

/**
 * Sends one webhook request.
 *
 * Everything that can go wrong here is *expected* to go wrong sometimes — the
 * receiver is a third party — so nothing throws: the caller records the outcome
 * and schedules a retry. Any 2xx counts as delivered; a receiver that wants to
 * be retried should answer 5xx (or 429), which is the convention every webhook
 * producer uses and which the docs state.
 */
export async function deliverWebhook(input: {
  url: string;
  secret: string;
  payload: WebhookEventPayload;
  attempt: number;
  timeoutMs?: number;
}): Promise<DeliveryAttempt> {
  // Re-checked per attempt, not just when the webhook was saved: DNS may have
  // moved to an internal address since (see the note in `url.ts`).
  const target = await checkWebhookTarget(input.url);
  if (!target.ok) {
    return { ok: false, responseStatus: null, error: `Ziel abgelehnt: ${target.reason}` };
  }

  const body = JSON.stringify(input.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const timeoutMs = input.timeoutMs ?? env.WEBHOOK_TIMEOUT_SECONDS * 1000;

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "nilovon-wiki-webhooks/1",
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: signWebhookPayload({ secret: input.secret, timestamp, body }),
        // Transport metadata stays in headers so the signed body is exactly the
        // event and a retry is byte-identical to the first attempt.
        "X-Wiki-Delivery": input.payload.id,
        "X-Wiki-Event": input.payload.event,
        "X-Wiki-Attempt": String(input.attempt),
      },
      body,
      // A receiver that accepts the connection and then stalls must not hold the
      // batch: without this the run's worst case is unbounded.
      signal: AbortSignal.timeout(timeoutMs),
      // Following a redirect would re-point the request at a host neither check
      // above ever saw — the cheapest SSRF bypass there is.
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        responseStatus: response.status,
        error: "Weiterleitungen werden nicht gefolgt (Sicherheitsgrund).",
      };
    }
    // The body is not needed, but an unread stream keeps the socket alive.
    await response.body?.cancel();

    return response.ok
      ? { ok: true, responseStatus: response.status, error: null }
      : { ok: false, responseStatus: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, responseStatus: null, error: describeFetchError(error, timeoutMs) };
  }
}

function describeFetchError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s`;
  }
  return error instanceof Error ? error.message : String(error);
}
