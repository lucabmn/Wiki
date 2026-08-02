import { pageIdFromDocName, verifyCollabToken } from "@nilovon-wiki/api/lib/collab-token";

export type CollabIdentity = {
  user: { id: string; name: string };
  /** Token expiry, in seconds — drives the periodic re-auth sweep. */
  exp: number;
};

/**
 * Decides whether a socket may open `documentName` with `token`.
 *
 * Split out of the server wiring so the rule is testable without a WebSocket:
 * this is the only thing standing between a stranger and a page's live
 * document. Authorization itself was already done by the API when it minted the
 * token (a full `page:write` check); here we verify that the token is genuine,
 * unexpired, and scoped to *this* page.
 *
 * Throws on rejection because Hocuspocus's `onAuthenticate` signals refusal by
 * throwing; the message is not shown to the client.
 */
export async function authorizeCollab(
  secret: string,
  token: string,
  documentName: string,
): Promise<CollabIdentity> {
  const pageId = pageIdFromDocName(documentName);
  if (!pageId) throw new Error("invalid document");

  const claims = await verifyCollabToken(secret, token);
  // Reject a missing/expired/tampered token, or a valid token scoped to a
  // different page than the socket is trying to open — without the scope check
  // any page's token would open every page.
  if (!claims || claims.p !== pageId) throw new Error("unauthorized");

  return { user: { id: claims.u, name: claims.n }, exp: claims.exp };
}
