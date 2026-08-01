import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  // `role` is the caller's *static* member role, which is separate from
  // `allowed`: a dynamic group can make the permission check pass while the
  // role stays `member`.
  state: { allowed: false, isPending: false, role: "member" },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Outlet: () => <div>outlet</div>,
  useRouteContext: () => ({
    auth: {
      session: { user: { id: "user-1" } },
      organization: { members: [{ userId: "user-1", role: state.role }] },
    },
  }),
}));

// Mirror useAnyPermission's contract: it resolves several requests as one OR,
// and is fail-closed while the round-trip is still in flight.
vi.mock("@/lib/permissions", () => ({
  useAnyPermission: () => state,
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { PermissionGate } from "@/components/settings/permission-gate";
import { Route } from "@/routes/_auth/settings/route";

const Settings = (Route as unknown as { component: () => ReactNode }).component;

const settle = (allowed: boolean, role = "member") => {
  state.allowed = allowed;
  state.isPending = false;
  state.role = role;
};

describe("settings layout", () => {
  it("always shows the personal tabs, even with no management rights", () => {
    settle(false);
    render(<Settings />);

    expect(screen.getByText("Profil")).toBeDefined();
    expect(screen.getByText("Sicherheit")).toBeDefined();
    expect(screen.getByText("Darstellung")).toBeDefined();
    // The area is no longer redirected away from — the outlet still renders.
    expect(screen.getByText("outlet")).toBeDefined();
  });

  it("hides the organization tabs from a caller without management rights", () => {
    settle(false);
    render(<Settings />);

    expect(screen.queryByText("Mitglieder")).toBeNull();
    expect(screen.queryByText("Gruppen")).toBeNull();
    expect(screen.queryByText("Teams")).toBeNull();
  });

  it("shows the organization tabs once the check settles as allowed", () => {
    settle(true);
    render(<Settings />);

    expect(screen.getByText("Mitglieder")).toBeDefined();
    expect(screen.getByText("Gruppen")).toBeDefined();
    expect(screen.getByText("Teams")).toBeDefined();
  });

  // The SSO/SCIM plugins carry their own authorization and only honour the
  // static owner/admin roles, so this tab must not follow the wider check that
  // reveals the rest of the section — it would 403 on submit.
  it("withholds the single sign-on tab from a manager whose right comes from a group", () => {
    settle(true, "redakteure");
    render(<Settings />);

    expect(screen.getByText("Mitglieder")).toBeDefined();
    expect(screen.queryByText("Single Sign-On")).toBeNull();
  });

  it("shows the single sign-on tab to an admin, including alongside other roles", () => {
    settle(true, "redakteure,admin");
    render(<Settings />);

    expect(screen.getByText("Single Sign-On")).toBeDefined();
  });

  it("does not reveal the organization tabs while the check is still pending", () => {
    state.allowed = false;
    state.isPending = true;
    render(<Settings />);

    expect(screen.getByText("Profil")).toBeDefined();
    expect(screen.queryByText("Mitglieder")).toBeNull();
  });
});

describe("settings permission gate", () => {
  it("withholds the content while the check is still pending", () => {
    state.allowed = false;
    state.isPending = true;
    render(
      <PermissionGate permissions={[{ member: ["update"] }]}>
        <div>geheim</div>
      </PermissionGate>,
    );

    expect(screen.queryByText("geheim")).toBeNull();
    expect(screen.queryByText("Kein Zugriff")).toBeNull();
  });

  it("explains the denial once the check settles as denied", () => {
    settle(false);
    render(
      <PermissionGate permissions={[{ member: ["update"] }]}>
        <div>geheim</div>
      </PermissionGate>,
    );

    expect(screen.queryByText("geheim")).toBeNull();
    expect(screen.getByText("Kein Zugriff")).toBeDefined();
  });

  // The case that documents why this check is server-backed: a member whose
  // right comes solely from a dynamic group holds no static role that grants it.
  it("admits a caller whose right comes only from a dynamic group grant", () => {
    settle(true);
    render(
      <PermissionGate permissions={[{ ac: ["create"] }]}>
        <div>geheim</div>
      </PermissionGate>,
    );

    expect(screen.getByText("geheim")).toBeDefined();
  });
});
