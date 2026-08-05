import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

// The policy mails the members a fresh requirement will lock out; capture them
// rather than opening an SMTP connection. Typed to the real `sendMail`
// signature so the assertions can read the messages back without casting.
const { sendMail, isMailConfigured } = vi.hoisted(() => ({
  sendMail: vi.fn(
    async (_mail: { to: string; subject: string; text: string; html: string }): Promise<void> => {},
  ),
  isMailConfigured: vi.fn(() => true),
}));
vi.mock("@nilovon-wiki/auth/mail", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendMail,
  isMailConfigured,
}));

import type { Database } from "@nilovon-wiki/db";
import { activity, organizationSetting, user } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../../src/index";
import { invalidateOrganizationSettings } from "../../src/lib/organization-settings";
import {
  assertTwoFactorCompliance,
  invalidateSecondFactorFacts,
} from "../../src/lib/two-factor-policy";
import { securityPolicyRouter } from "../../src/routers/security-policy";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";
import { FUTURE as future, PAST as past, seedTwoFactorFixture } from "./two-factor-fixture";

let db: TestDb;
let dbAs: Database;

/**
 * Stands in for every procedure in the app: they all descend from
 * `protectedProcedure`, so whatever the two-factor middleware does to this one
 * it does to `pages.list` too.
 */
const probe = protectedProcedure
  .input(z.object({}))
  .output(z.string())
  .handler(() => "ok");

beforeAll(async () => {
  db = await createTestDb();
  dbAs = db as unknown as Database;
  await seedTwoFactorFixture(db);
});

afterAll(async () => {
  await db.$end();
});

beforeEach(async () => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
  sendMail.mockClear();
  isMailConfigured.mockReturnValue(true);
  await db.delete(organizationSetting);
  await db.delete(activity);
  // Both caches live in-process, so every test starts cold.
  invalidateOrganizationSettings();
  invalidateSecondFactorFacts();
});

async function setPolicy(
  organizationId: string,
  values: { required: boolean; graceUntil?: Date | null; requireForSso?: boolean },
) {
  await db.insert(organizationSetting).values({
    organizationId,
    twoFactorRequired: values.required,
    twoFactorGraceUntil: values.graceUntil ?? null,
    twoFactorRequireForSso: values.requireForSso ?? false,
  });
  invalidateOrganizationSettings();
}

const ctx = (userId: string, organizationId: string | null) =>
  testContext(db, { userId, activeOrganizationId: organizationId });

const callProbe = (userId: string, organizationId: string | null) =>
  call(probe, {}, { context: ctx(userId, organizationId) });

const callStatus = (userId: string, organizationId: string | null) =>
  call(securityPolicyRouter.getMyTwoFactorStatus, {}, { context: ctx(userId, organizationId) });

describe("no requirement", () => {
  it("leaves a user without a second factor untouched when no row exists", async () => {
    await expect(callProbe("uNone", "oA")).resolves.toBe("ok");
    await expect(callStatus("uNone", "oA")).resolves.toMatchObject({
      status: "ok",
      required: false,
    });
  });

  it("leaves them untouched with an explicit twoFactorRequired = false", async () => {
    await setPolicy("oA", { required: false });
    await expect(callProbe("uNone", "oA")).resolves.toBe("ok");
  });
});

describe("enforcement", () => {
  it("refuses a user without a second factor once the grace period has passed", async () => {
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callProbe("uNone", "oA")).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
      status: 403,
    });
  });

  it("refuses just as hard when no grace period was ever set", async () => {
    await setPolicy("oA", { required: true, graceUntil: null });
    await expect(callProbe("uNone", "oA")).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
    });
  });

  it("still answers the status procedure for a blocked user", async () => {
    // Enrolling and signing out are Better Auth routes under `/api/auth/*` and
    // never reach oRPC, so those exemptions are structural. This is the one
    // that has to be exempt *inside* oRPC — the blocking screen cannot explain
    // itself without it.
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callStatus("uNone", "oA")).resolves.toMatchObject({
      status: "blocked",
      required: true,
      hasSecondFactor: false,
    });
  });

  it("lets a user with TOTP through unchanged", async () => {
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callProbe("uTotp", "oA")).resolves.toBe("ok");
    await expect(callStatus("uTotp", "oA")).resolves.toMatchObject({
      status: "ok",
      hasSecondFactor: true,
    });
  });

  it("accepts a registered passkey as the second factor", async () => {
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callProbe("uPass", "oA")).resolves.toBe("ok");
    await expect(callStatus("uPass", "oA")).resolves.toMatchObject({
      status: "ok",
      hasSecondFactor: true,
    });
  });

  it("exempts SSO accounts by default and stops doing so on request", async () => {
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callProbe("uSso", "oA")).resolves.toBe("ok");
    await expect(callStatus("uSso", "oA")).resolves.toMatchObject({
      status: "ok",
      exemptAsSso: true,
    });

    await db.delete(organizationSetting);
    await setPolicy("oA", { required: true, graceUntil: past, requireForSso: true });
    invalidateSecondFactorFacts();
    await expect(callProbe("uSso", "oA")).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
    });
  });

  it("allows access during the grace period and warns in the status", async () => {
    await setPolicy("oA", { required: true, graceUntil: future });
    await expect(callProbe("uNone", "oA")).resolves.toBe("ok");
    await expect(callStatus("uNone", "oA")).resolves.toMatchObject({
      status: "grace",
      required: true,
      graceUntil: future,
      hasSecondFactor: false,
    });
  });

  it("refuses the byte-serving routes that sit outside oRPC", async () => {
    // Space exports and attachment uploads call this directly; without it the
    // policy would stop at the JSON API.
    await setPolicy("oA", { required: true, graceUntil: past });
    const session = { user: { id: "uNone" }, session: { activeOrganizationId: "oA" } };
    await expect(assertTwoFactorCompliance(dbAs, session)).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
      status: 403,
    });
    await expect(
      assertTwoFactorCompliance(dbAs, {
        user: { id: "uTotp" },
        session: { activeOrganizationId: "oA" },
      }),
    ).resolves.toBeUndefined();
  });

  it("does not leak one organization's policy into another", async () => {
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callProbe("uOther", "oB")).resolves.toBe("ok");
    await expect(callStatus("uOther", "oB")).resolves.toMatchObject({ status: "ok" });
  });

  it("unblocks on the very next request once a factor is enrolled", async () => {
    await setPolicy("oA", { required: true, graceUntil: past });
    await expect(callProbe("uNone", "oA")).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
    });

    // Enrolment happens through Better Auth, so nothing invalidates the API's
    // cache. The blocked path must therefore never be served from it.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, "uNone"));
    await expect(callProbe("uNone", "oA")).resolves.toBe("ok");
    await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, "uNone"));
  });
});

describe("administration", () => {
  const update = (userId: string, twoFactorRequired: boolean, graceUntil: Date | null = null) =>
    call(
      securityPolicyRouter.updateTwoFactorPolicy,
      { twoFactorRequired, twoFactorGraceUntil: graceUntil, twoFactorRequireForSso: false },
      { context: ctx(userId, "oA") },
    );

  it("refuses a member without organization:update", async () => {
    hasPermission.mockResolvedValue({ success: false });
    await expect(update("uTotp", true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await dbAs.select().from(organizationSetting)).toHaveLength(0);
  });

  it("stores the policy, audits the activation and mails those affected", async () => {
    await update("uAdmin", true, future);

    const [row] = await dbAs
      .select()
      .from(organizationSetting)
      .where(eq(organizationSetting.organizationId, "oA"));
    expect(row).toMatchObject({ twoFactorRequired: true, twoFactorGraceUntil: future });

    const audit = await dbAs.select().from(activity);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: "oA",
      action: "organization.two_factor_enabled",
      actorId: "uAdmin",
    });

    // uNone and uAdmin lack a factor; uSso is spared by the exemption, and
    // uTotp/uPass already comply.
    const recipients = sendMail.mock.calls.map(([mail]) => mail.to).sort();
    expect(recipients).toEqual(["ada@x.test", "nora@x.test"]);
  });

  it("takes effect immediately rather than after the cache TTL", async () => {
    await expect(callProbe("uNone", "oA")).resolves.toBe("ok"); // warms the cache
    await update("uAdmin", true, past);
    await expect(callProbe("uNone", "oA")).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
    });
  });

  it("audits a deactivation and does not re-mail on an unchanged save", async () => {
    await setPolicy("oA", { required: true, graceUntil: future });
    await update("uAdmin", false);

    const audit = await dbAs.select().from(activity);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("organization.two_factor_disabled");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("audits a changed deadline while the requirement stays on", async () => {
    await setPolicy("oA", { required: true, graceUntil: future });
    await update("uAdmin", true, past);

    const audit = await dbAs.select().from(activity);
    expect(audit.map((row) => row.action)).toEqual(["organization.two_factor_grace_updated"]);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("reports member compliance so the switch is explainable", async () => {
    const overview = await call(
      securityPolicyRouter.getTwoFactorPolicy,
      {},
      { context: ctx("uAdmin", "oA") },
    );
    expect(overview.memberCount).toBe(5);
    expect(overview.nonCompliant.map((e) => e.userId).sort()).toEqual(["uAdmin", "uNone", "uSso"]);
    expect(overview.nonCompliant.find((entry) => entry.userId === "uSso")?.isSsoAccount).toBe(true);
  });
});
