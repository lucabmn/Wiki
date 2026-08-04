import { call, ORPCError } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The admin router delegates its mutations to Better Auth's `admin()` endpoints.
// Stubbing them keeps these suites on what this package owns — the gate, the
// last-admin guard and the audit trail — instead of re-testing the plugin.
const {
  banUser,
  setRole,
  removeUser,
  revokeUserSession,
  revokeUserSessions,
  requestPasswordReset,
  hasPermission,
} = vi.hoisted(() => ({
  banUser: vi.fn(),
  setRole: vi.fn(),
  removeUser: vi.fn(),
  revokeUserSession: vi.fn(),
  revokeUserSessions: vi.fn(),
  requestPasswordReset: vi.fn(),
  hasPermission: vi.fn(),
}));
vi.mock("@nilovon-wiki/auth", () => ({
  auth: {
    api: {
      banUser,
      setRole,
      removeUser,
      revokeUserSession,
      revokeUserSessions,
      requestPasswordReset,
      unbanUser: vi.fn(),
      hasPermission,
    },
  },
}));

import { user } from "@nilovon-wiki/db/schema/index";

import { adminAuditRouter } from "../../src/routers/admin/audit";
import { adminOrganizationRouter } from "../../src/routers/admin/organizations";
import { adminSessionRouter } from "../../src/routers/admin/sessions";
import { adminUserActionRouter } from "../../src/routers/admin/user-actions";
import { adminUserRouter } from "../../src/routers/admin/users";
import { adminContext, seedInstance, type AuditDb } from "./admin-fixture";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";
import type { Context } from "../../src/context";

let db: AuditDb;
const ctx = (userId: string, role: string | null, impersonatedBy?: string) =>
  adminContext(db, userId, role, impersonatedBy);
const ctxAdmin = () => ctx("uAdmin", "admin");
const ctxOwner = () => ctx("uOwner", null);

beforeAll(async () => {
  db = await seedInstance();
});

afterAll(async () => {
  await db.$end();
});

beforeEach(() => {
  for (const fn of [banUser, setRole, removeUser, revokeUserSession, revokeUserSessions]) {
    fn.mockReset();
    fn.mockResolvedValue({});
  }
  requestPasswordReset.mockReset();
  requestPasswordReset.mockResolvedValue({ status: true });
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: false });
});

describe("instance-admin gate", () => {
  // Every procedure, not a sample: a gate that is only mostly applied is no gate.
  const procedures = [
    ["users.list", adminUserRouter.list, {}],
    ["users.get", adminUserRouter.get, { userId: "uPlain" }],
    ["users.setRole", adminUserActionRouter.setRole, { userId: "uPlain", role: "admin" }],
    ["users.ban", adminUserActionRouter.ban, { userId: "uPlain", reason: "weil" }],
    ["users.unban", adminUserActionRouter.unban, { userId: "uPlain" }],
    ["users.remove", adminUserActionRouter.remove, { userId: "uPlain" }],
    ["users.sendPasswordReset", adminUserActionRouter.sendPasswordReset, { userId: "uPlain" }],
    ["sessions.list", adminSessionRouter.list, { userId: "uPlain" }],
    ["sessions.revoke", adminSessionRouter.revoke, { userId: "uPlain", sessionToken: "tok-plain" }],
    ["sessions.revokeAll", adminSessionRouter.revokeAll, { userId: "uPlain" }],
    ["organizations.list", adminOrganizationRouter.list, {}],
    ["organizations.get", adminOrganizationRouter.get, { organizationId: "oA" }],
    ["audit.list", adminAuditRouter.list, {}],
  ] as const;

  it.each(procedures)("refuses an org owner on %s", async (_name, procedure, input) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous inputs
    await expect(call(procedure as any, input, { context: ctxOwner() })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses an impersonated session even when the impersonated account is an admin", async () => {
    await expect(
      call(adminUserRouter.list, {}, { context: ctx("uAdmin", "admin", "uSecond") }),
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("admits an account whose role list merely contains admin", async () => {
    const result = await call(adminUserRouter.list, {}, { context: ctx("uSecond", "owner,admin") });
    expect(result.total).toBeGreaterThan(0);
  });
});

describe("users.list", () => {
  it("counts organizations and only unexpired sessions", async () => {
    const result = await call(adminUserRouter.list, { query: "pia" }, { context: ctxAdmin() });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      email: "pia@x.io",
      organizationCount: 2,
      activeSessionCount: 1,
      banned: false,
    });
  });

  it("finds admins inside a comma-separated role list", async () => {
    const result = await call(adminUserRouter.list, { filter: "admins" }, { context: ctxAdmin() });
    expect(result.items.map((row) => row.id).sort()).toEqual(["uAdmin", "uSecond"]);
  });
});

describe("users.get", () => {
  it("reports memberships and sign-in factors, never content", async () => {
    const detail = await call(adminUserRouter.get, { userId: "uPlain" }, { context: ctxAdmin() });
    expect(detail.organizations.map((org) => org.id).sort()).toEqual(["oA", "oB"]);
    expect(detail.twoFactorEnabled).toBe(false);
    expect(detail.passkeyCount).toBe(0);
    expect(detail).not.toHaveProperty("pages");
  });
});

describe("last instance admin", () => {
  it("refuses to demote, ban or delete the only remaining admin", async () => {
    const solo = await createTestDb();
    await solo.insert(user).values([
      { id: "only", name: "Only", email: "only@x.io", role: "admin" },
      { id: "other", name: "Other", email: "other@x.io", role: "user" },
    ]);
    const soloCtx = {
      ...testContext(solo as unknown as TestDb, { userId: "only", activeOrganizationId: null }),
      session: { session: {}, user: { id: "only", role: "admin", email: "only@x.io" } },
    } as unknown as Context;

    await expect(
      call(adminUserActionRouter.setRole, { userId: "only", role: "user" }, { context: soloCtx }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(adminUserActionRouter.remove, { userId: "only" }, { context: soloCtx }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setRole).not.toHaveBeenCalled();
    expect(removeUser).not.toHaveBeenCalled();

    // A non-admin is unaffected by the guard.
    await call(adminUserActionRouter.remove, { userId: "other" }, { context: soloCtx });
    expect(removeUser).toHaveBeenCalledOnce();
    await solo.$end();
  });
});

describe("sessions", () => {
  it("lists live sessions only and marks the caller's own", async () => {
    const rows = await call(adminSessionRouter.list, { userId: "uPlain" }, { context: ctxAdmin() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: "tok-plain", ipAddress: "10.0.0.1", current: false });
  });

  it("delegates revocation so Better Auth tears the session down", async () => {
    await call(
      adminSessionRouter.revoke,
      { userId: "uPlain", sessionToken: "tok-plain" },
      { context: ctxAdmin() },
    );
    expect(revokeUserSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { sessionToken: "tok-plain" } }),
    );
  });
});
