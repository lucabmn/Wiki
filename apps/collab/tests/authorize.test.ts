import { collabDocName, signCollabToken } from "@nilovon-wiki/api/lib/collab-token";
import { describe, expect, it } from "vitest";

import { authorizeCollab } from "../src/authorize";

const SECRET = "collab-test-signing-key-0123456789abcdef";
const OTHER_SECRET = "another-signing-key-0123456789abcdefgh";

const tokenFor = (pageId: string, secret = SECRET) =>
  signCollabToken(secret, { p: pageId, u: "u1", n: "Alice" });

describe("authorizeCollab", () => {
  it("admits a token minted for the document being opened", async () => {
    const token = await tokenFor("p1");
    const identity = await authorizeCollab(SECRET, token, collabDocName("p1"));
    expect(identity.user).toEqual({ id: "u1", name: "Alice" });
    expect(identity.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a token scoped to a different page", async () => {
    // Without the scope check, write access to any one page would open every
    // page's live document.
    const token = await tokenFor("p1");
    await expect(authorizeCollab(SECRET, token, collabDocName("p2"))).rejects.toThrow(
      "unauthorized",
    );
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await tokenFor("p1", OTHER_SECRET);
    await expect(authorizeCollab(SECRET, token, collabDocName("p1"))).rejects.toThrow(
      "unauthorized",
    );
  });

  it("rejects a tampered payload", async () => {
    const token = await tokenFor("p1");
    const [payload, signature] = token.split(".");
    const forged = `${payload}x.${signature}`;
    await expect(authorizeCollab(SECRET, forged, collabDocName("p1"))).rejects.toThrow(
      "unauthorized",
    );
  });

  it("rejects an empty token", async () => {
    await expect(authorizeCollab(SECRET, "", collabDocName("p1"))).rejects.toThrow("unauthorized");
  });

  it("rejects a document name outside the page namespace", async () => {
    const token = await tokenFor("p1");
    await expect(authorizeCollab(SECRET, token, "space:p1")).rejects.toThrow("invalid document");
  });
});
