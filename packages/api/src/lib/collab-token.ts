/**
 * Capability tokens for the real-time collaboration WebSocket (`apps/collab`).
 *
 * The collab server runs as a separate Node process on its own port, so the
 * browser can't reach it with the httpOnly session cookie over dev `ws://`.
 * Instead the *authoritative* API server (which already has the full session and
 * page-authorization machinery) mints a short-lived, page-scoped token once the
 * caller has proven `page: write`. The token IS the capability grant: the collab
 * server only verifies the HMAC signature and expiry — it never re-derives
 * authorization, so the org-manager override and per-page ACLs stay in exactly
 * one place. Revocation latency is bounded by {@link COLLAB_TOKEN_TTL_SECONDS}.
 *
 * The signing key is `BETTER_AUTH_SECRET`, shared by both processes. The token
 * is a compact `base64url(payload).base64url(hmac)` string (not a full JWT — no
 * dependency, and both runtimes ship Web Crypto).
 */

export const COLLAB_TOKEN_TTL_SECONDS = 5 * 60;

/** Doc name convention: one Yjs document per page. */
export function collabDocName(pageId: string): string {
  return `page:${pageId}`;
}

export function pageIdFromDocName(docName: string): string | null {
  const match = /^page:(.+)$/.exec(docName);
  return match ? (match[1] ?? null) : null;
}

export type CollabTokenClaims = {
  /** User id (attribution + awareness). */
  u: string;
  /** Display name for collaboration cursors. */
  n: string;
  /** Page id this grant is scoped to. */
  p: string;
  /** Expiry, epoch seconds. */
  exp: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign a capability token. `nowSeconds` is injectable for tests. */
export async function signCollabToken(
  secret: string,
  claims: Omit<CollabTokenClaims, "exp">,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: CollabTokenClaims = { ...claims, exp: nowSeconds + COLLAB_TOKEN_TTL_SECONDS };
  const payloadSegment = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadSegment));
  return `${payloadSegment}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify a token's signature and expiry. Returns the claims on success, or
 * `null` for any malformed / tampered / expired token — the caller treats a
 * `null` as an authentication failure. Uses `crypto.subtle.verify` so the
 * comparison is constant-time.
 */
export async function verifyCollabToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<CollabTokenClaims | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadSegment = token.slice(0, dot);
  const signatureSegment = token.slice(dot + 1);

  let signature: Uint8Array;
  try {
    signature = fromBase64Url(signatureSegment);
  } catch {
    return null;
  }

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(payloadSegment),
  );
  if (!valid) return null;

  let claims: CollabTokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadSegment)));
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds) return null;
  if (!claims.u || !claims.p) return null;
  return claims;
}
