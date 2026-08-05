import type { Database } from "@nilovon-wiki/db";
import { member, organization, session, space, user } from "@nilovon-wiki/db/schema/index";

import type { Context } from "../../src/context";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

/**
 * Shared instance fixture for the admin suites.
 *
 * The cast is the whole reason this lives apart: `recordAdminAudit` and friends
 * take the app's node-postgres handle, and pglite is structurally the same at
 * every call site they use.
 */
export type AuditDb = TestDb & { asDatabase: Database };

export const NOW = new Date();
export const LATER = new Date(NOW.getTime() + 60 * 60 * 1000);
export const EARLIER = new Date(NOW.getTime() - 60 * 60 * 1000);

/**
 * One instance with two organizations:
 *
 * - `uAdmin` holds the instance role.
 * - `uOwner` is an org OWNER with no instance role — the account that proves
 *   org power grants nothing here.
 * - `uPlain` is an ordinary member of both orgs, with one live and one expired
 *   session.
 * - `uSecond` carries `owner,admin`, so the comma-separated role list is exercised.
 */
export async function seedInstance(): Promise<AuditDb> {
  const db = (await createTestDb()) as AuditDb;
  db.asDatabase = db as unknown as Database;

  await db.insert(user).values([
    { id: "uAdmin", name: "Ada", email: "ada@x.io", role: "admin", createdAt: EARLIER },
    { id: "uOwner", name: "Otto", email: "otto@x.io", role: "user", createdAt: EARLIER },
    { id: "uPlain", name: "Pia", email: "pia@x.io", role: null, createdAt: NOW },
    { id: "uSecond", name: "Sam", email: "sam@x.io", role: "owner,admin", createdAt: NOW },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "Acme", slug: "acme", createdAt: EARLIER },
    { id: "oB", name: "Beta", slug: "beta", createdAt: NOW },
  ]);
  await db.insert(member).values([
    { id: "m1", organizationId: "oA", userId: "uOwner", role: "owner", createdAt: EARLIER },
    { id: "m2", organizationId: "oA", userId: "uPlain", role: "member", createdAt: NOW },
    { id: "m3", organizationId: "oB", userId: "uPlain", role: "member", createdAt: NOW },
  ]);
  await db
    .insert(space)
    .values([{ id: "sA", organizationId: "oA", slug: "s", name: "S", visibility: "public" }]);
  await db.insert(session).values([
    {
      id: "sess1",
      userId: "uPlain",
      token: "tok-plain",
      expiresAt: LATER,
      createdAt: NOW,
      updatedAt: NOW,
      ipAddress: "10.0.0.1",
    },
    // Already expired → must never be reported as an active session.
    {
      id: "sess2",
      userId: "uPlain",
      token: "tok-stale",
      expiresAt: EARLIER,
      createdAt: EARLIER,
      updatedAt: EARLIER,
    },
  ]);
  return db;
}

/** A handler context whose session carries an instance role, and optionally an impersonator. */
export function adminContext(
  db: TestDb,
  userId: string,
  role: string | null,
  impersonatedBy?: string,
): Context {
  const base = testContext(db, { userId, activeOrganizationId: "oA" });
  return {
    ...base,
    session: {
      session: {
        activeOrganizationId: "oA",
        token: `tok-${userId}`,
        ...(impersonatedBy ? { impersonatedBy } : {}),
      },
      user: { id: userId, role, email: `${userId}@x.io`, name: userId },
    },
  } as unknown as Context;
}
