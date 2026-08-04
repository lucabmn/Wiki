import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Request signing.
 *
 * The signature covers `timestamp + "." + body`, not the body alone: a body-only
 * signature stays valid forever, so anyone who captures one request can replay
 * it at will. Binding the timestamp into the MAC means a receiver can reject
 * anything older than its own tolerance and the attacker cannot re-stamp it.
 */

export const SIGNATURE_HEADER = "X-Wiki-Signature";
export const TIMESTAMP_HEADER = "X-Wiki-Timestamp";

/** Recognisable prefix + 32 bytes of entropy, URL-safe so it survives copy-paste. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/**
 * What `list` may show. The prefix identifies which secret a receiver holds
 * without being enough to forge a signature with.
 */
export function webhookSecretPreview(secret: string): string {
  return `${secret.slice(0, 12)}…`;
}

export function signWebhookPayload(input: {
  secret: string;
  /** Unix seconds, as sent in `X-Wiki-Timestamp`. */
  timestamp: number;
  /** The exact bytes of the request body, as sent. */
  body: string;
}): string {
  const mac = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
  return `sha256=${mac}`;
}

/**
 * The check a receiver performs, kept here so the documented verification
 * snippet and the test suite exercise the very code that produced the header.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
}): boolean {
  const expected = Buffer.from(signWebhookPayload(input));
  const presented = Buffer.from(input.signature);
  // Length differs long before the digest does, and a length check cannot be
  // constant-time — but the length of a fixed-format digest is not a secret.
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}
