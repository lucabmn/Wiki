import { call } from "@orpc/server";
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

import { recordAdminAudit, mirrorImpersonationActivity } from "@nilovon-wiki/auth/admin-audit";
import { eq } from "drizzle-orm";
import { activity, adminAudit, user } from "@nilovon-wiki/db/schema/index";

import { adminAuditRouter } from "../../src/routers/admin/audit";
import { adminOrganizationRouter } from "../../src/routers/admin/organizations";
import { adminUserActionRouter } from "../../src/routers/admin/user-actions";
import { spaceRouter } from "../../src/routers/space";
import { adminContext, seedInstance, type AuditDb } from "./admin-fixture";

let db: AuditDb;
const ctx = (userId: string, role: string | null, impersonatedBy?: string) =>
  adminContext(db, userId, role, impersonatedBy);
const ctxAdmin = () => ctx("uAdmin", "admin");

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

describe("password reset", () => {
  it("mails a reset link and records it — the one action no auth hook sees", async () => {
    await call(
      adminUserActionRouter.sendPasswordReset,
      { userId: "uPlain" },
      { context: ctxAdmin() },
    );
    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ email: "pia@x.io" }) }),
    );

    const rows = await call(
      adminAuditRouter.list,
      { action: "user.password_reset_requested" },
      { context: ctxAdmin() },
    );
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({ actorId: "uAdmin", targetUserId: "uPlain" });
  });
});

describe("impersonation audit", () => {
  it("produces exactly two entries naming the real actor and the target", async () => {
    const admin = { id: "uAdmin", email: "ada@x.io", name: "Ada" };
    const target = { id: "uPlain", email: "pia@x.io", name: "Pia" };

    const auditDb = db.asDatabase;
    await recordAdminAudit(auditDb, { action: "impersonation.started", actor: admin, target });
    await mirrorImpersonationActivity(auditDb, { action: "impersonation.started", admin, target });
    await recordAdminAudit(auditDb, { action: "impersonation.ended", actor: admin, target });
    await mirrorImpersonationActivity(auditDb, { action: "impersonation.ended", admin, target });

    const entries = await call(adminAuditRouter.list, {}, { context: ctxAdmin() });
    const impersonation = entries.items.filter((row) => row.action.startsWith("impersonation."));
    expect(impersonation).toHaveLength(2);
    for (const row of impersonation) {
      expect(row).toMatchObject({
        actorId: "uAdmin",
        actorEmail: "ada@x.io",
        targetUserId: "uPlain",
        targetEmail: "pia@x.io",
      });
    }
  });

  it("mirrors both events into every organization the target belongs to", async () => {
    const rows = await db.select().from(activity);
    const mirrored = rows.filter((row) => row.action.startsWith("impersonation."));
    // Two events × two memberships (oA and oB).
    expect(mirrored).toHaveLength(4);
    expect(new Set(mirrored.map((row) => row.organizationId))).toEqual(new Set(["oA", "oB"]));
    for (const row of mirrored) {
      // Attributed to the target so it lands in *their* activity filter, with
      // the admin named alongside — both identities, never one.
      expect(row.actorId).toBe("uPlain");
      expect(row.impersonatedBy).toBe("uAdmin");
    }
  });
});

describe("admin audit storage", () => {
  it("keeps naming the target after the account is deleted", async () => {
    await recordAdminAudit(db.asDatabase, {
      action: "user.deleted",
      actor: { id: "uAdmin", email: "ada@x.io" },
      target: { id: "uSecond", email: "sam@x.io", name: "Sam" },
    });
    await db.delete(user).where(eq(user.id, "uSecond"));

    const rows = await call(
      adminAuditRouter.list,
      { action: "user.deleted" },
      { context: ctxAdmin() },
    );
    expect(rows.items[0]).toMatchObject({
      // The FK nulls out; the denormalized address is what survives.
      targetUserId: null,
      targetEmail: "sam@x.io",
    });
  });
});

describe("admin_audit is not the org feed", () => {
  it("stores instance events outside wiki.activity", async () => {
    const auditRows = await db.select().from(adminAudit);
    expect(auditRows.length).toBeGreaterThan(0);
    // Nothing in the org-scoped feed carries an instance-only action.
    const feed = await db.select().from(activity);
    expect(feed.every((row) => !row.action.startsWith("user."))).toBe(true);
  });
});

describe("organization aggregates", () => {
  it("counts members, spaces and pages without inflating them across joins", async () => {
    const result = await call(adminOrganizationRouter.list, {}, { context: ctxAdmin() });
    const acme = result.items.find((row) => row.id === "oA");
    // Two members and one space; the joins multiply rows, the counts must not.
    expect(acme).toMatchObject({ memberCount: 2, spaceCount: 1, pageCount: 0, storageBytes: 0 });
    expect(result.items.find((row) => row.id === "oB")).toMatchObject({
      memberCount: 1,
      spaceCount: 0,
    });
  });

  it("lists a tenant's spaces as metadata only", async () => {
    const detail = await call(
      adminOrganizationRouter.get,
      { organizationId: "oA" },
      { context: ctxAdmin() },
    );
    expect(detail.owners.map((owner) => owner.id)).toEqual(["uOwner"]);
    expect(detail.spaces).toHaveLength(1);
    expect(detail.spaces[0]).toMatchObject({ slug: "s", pageCount: 0, storageBytes: 0 });
    expect(detail.spaces[0]).not.toHaveProperty("content");
  });
});

describe("writes made while impersonating", () => {
  it("records the impersonated account and the real admin", async () => {
    // The org-manager override is what `space.update` gates on.
    hasPermission.mockResolvedValue({ success: true });

    await call(
      spaceRouter.update,
      { id: "sA", name: "Renamed" },
      // uPlain's account, driven by uAdmin.
      { context: ctx("uPlain", null, "uAdmin") },
    );

    const rows = await db.select().from(activity).where(eq(activity.action, "space.updated"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: "uPlain", impersonatedBy: "uAdmin" });
  });

  it("leaves impersonatedBy null for an ordinary edit", async () => {
    hasPermission.mockResolvedValue({ success: true });

    await call(spaceRouter.archive, { id: "sA" }, { context: ctx("uPlain", null) });

    const rows = await db.select().from(activity).where(eq(activity.action, "space.archived"));
    expect(rows[0]).toMatchObject({ actorId: "uPlain", impersonatedBy: null });
  });
});
