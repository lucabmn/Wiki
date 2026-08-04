import {
  account,
  member,
  organization,
  passkey,
  ssoProvider,
  user,
} from "@nilovon-wiki/db/schema/index";

import type { TestDb } from "./db";

export const NOW = new Date("2026-08-04T10:00:00Z");
export const PAST = new Date("2026-07-01T10:00:00Z");
export const FUTURE = new Date("2026-09-01T10:00:00Z");

/**
 * The cast of the two-factor policy suite.
 *
 * Org A carries the policy, org B is the control. In A: `uNone` has no second
 * factor, `uTotp` has TOTP, `uPass` only a passkey, `uSso` signs in through an
 * IdP and has neither, `uAdmin` may edit the policy but has no factor either.
 * `uOther` lives in B alone, which is what makes the cross-org test meaningful.
 */
export async function seedTwoFactorFixture(db: TestDb): Promise<void> {
  await db.insert(user).values([
    { id: "uNone", name: "Nora", email: "nora@x.test", createdAt: NOW, updatedAt: NOW },
    {
      id: "uTotp",
      name: "Tom",
      email: "tom@x.test",
      createdAt: NOW,
      updatedAt: NOW,
      twoFactorEnabled: true,
    },
    { id: "uPass", name: "Pia", email: "pia@x.test", createdAt: NOW, updatedAt: NOW },
    { id: "uSso", name: "Sam", email: "sam@x.test", createdAt: NOW, updatedAt: NOW },
    { id: "uAdmin", name: "Ada", email: "ada@x.test", createdAt: NOW, updatedAt: NOW },
    { id: "uOther", name: "Otto", email: "otto@x.test", createdAt: NOW, updatedAt: NOW },
  ]);

  await db.insert(organization).values([
    { id: "oA", name: "Acme", slug: "acme", createdAt: NOW },
    { id: "oB", name: "Other", slug: "other", createdAt: NOW },
  ]);

  await db.insert(member).values([
    { id: "m1", organizationId: "oA", userId: "uNone", role: "member", createdAt: NOW },
    { id: "m2", organizationId: "oA", userId: "uTotp", role: "member", createdAt: NOW },
    { id: "m3", organizationId: "oA", userId: "uPass", role: "member", createdAt: NOW },
    { id: "m4", organizationId: "oA", userId: "uSso", role: "member", createdAt: NOW },
    { id: "m5", organizationId: "oA", userId: "uAdmin", role: "admin", createdAt: NOW },
    { id: "m6", organizationId: "oB", userId: "uOther", role: "member", createdAt: NOW },
  ]);

  await db.insert(passkey).values({
    id: "pk1",
    userId: "uPass",
    publicKey: "key",
    credentialID: "cred",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: NOW,
  });

  // An SSO account is an `account` row whose provider id names a registered
  // `sso_provider` — exactly how the plugin links the two, and what the policy
  // matches on.
  await db.insert(ssoProvider).values({
    id: "sso1",
    issuer: "https://idp.test",
    userId: "uAdmin",
    providerId: "idp-acme",
    organizationId: "oA",
    domain: "x.test",
    domainVerified: true,
  });
  await db.insert(account).values({
    id: "acc1",
    accountId: "sam@x.test",
    providerId: "idp-acme",
    userId: "uSso",
    createdAt: NOW,
    updatedAt: NOW,
  });
}
