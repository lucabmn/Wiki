import { describe, expect, it, vi } from "vitest";

import { isInstanceAdminSession } from "@/lib/instance-admin";

const { getInstanceAdmin } = vi.hoisted(() => ({ getInstanceAdmin: vi.fn() }));

vi.mock("@/functions/get-instance-admin", () => ({ getInstanceAdmin }));
vi.mock("@/components/layouts/dashboard-layout", () => ({ default: () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: () => null,
  Outlet: () => null,
  // The real one throws a redirect object; keeping it a throw is the behaviour
  // under test — `beforeLoad` must abort, not merely return.
  redirect: (options: unknown) => ({ isRedirect: true, options }),
}));

import { Route } from "@/routes/_auth/admin/route";

/**
 * `createFileRoute` is mocked to hand back the options object verbatim, so the
 * guard is callable here — the real return type has no such property.
 */
const beforeLoad = (Route as unknown as { beforeLoad: () => Promise<unknown> }).beforeLoad;

describe("admin route gate", () => {
  it("turns a non-admin away even on a direct URL", async () => {
    getInstanceAdmin.mockResolvedValue({ isInstanceAdmin: false });

    // Hiding the sidebar entry is cosmetic; this is the check that makes typing
    // /admin useless. The verdict comes from the server function, not from
    // anything the browser could set.
    await expect(beforeLoad()).rejects.toMatchObject({
      isRedirect: true,
      options: { to: "/" },
    });
  });

  it("lets an instance admin through", async () => {
    getInstanceAdmin.mockResolvedValue({ isInstanceAdmin: true });
    await expect(beforeLoad()).resolves.toBeUndefined();
  });
});

describe("who counts as an instance admin", () => {
  const impersonated = (role: string | null) => ({
    session: { impersonatedBy: "uAdmin" },
    user: { role },
  });

  it("accepts the admin role on its own or inside a list", () => {
    expect(isInstanceAdminSession({ session: {}, user: { role: "admin" } })).toBe(true);
    expect(isInstanceAdminSession({ session: {}, user: { role: "owner,admin" } })).toBe(true);
  });

  it("rejects org power and missing roles alike", () => {
    expect(isInstanceAdminSession({ session: {}, user: { role: "owner" } })).toBe(false);
    expect(isInstanceAdminSession({ session: {}, user: { role: null } })).toBe(false);
    expect(isInstanceAdminSession(null)).toBe(false);
  });

  it("rejects an impersonated session even when the borrowed account is an admin", () => {
    // The console would otherwise run under someone else's identity, and the
    // audit log would name the wrong person.
    expect(isInstanceAdminSession(impersonated("admin"))).toBe(false);
  });
});
