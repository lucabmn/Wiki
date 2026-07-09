/**
 * Cryptographically strong secrets for a fresh install. Uses the Web Crypto
 * `getRandomValues` (available in Bun and Node ≥ 20) — no external deps.
 */

/** Base64 secret with at least `bytes` of entropy. `BETTER_AUTH_SECRET` needs ≥ 32 chars. */
export function generateSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64");
}

/**
 * URL/connection-string-safe password (no `@ : / ?` etc. that would break a
 * `postgresql://user:pass@host` DSN). Hex keeps it copy-paste safe everywhere.
 */
export function generatePassword(bytes = 18): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("hex");
}
