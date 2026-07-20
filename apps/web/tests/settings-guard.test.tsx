import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { state, navigate } = vi.hoisted(() => ({
  state: { member: { allowed: false, isPending: false }, ac: { allowed: false, isPending: false } },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Outlet: () => <div>outlet</div>,
}));

// Mirror usePermission's contract: the answer depends on which permission was
// asked for, and it is fail-closed while the round-trip is still in flight.
vi.mock("@/lib/permissions", () => ({
  usePermission: (permissions: Record<string, string[]>) =>
    "member" in permissions ? state.member : state.ac,
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { Route } from "@/routes/_auth/settings/route";

const Settings = (Route as unknown as { component: () => ReactNode }).component;

const settle = (member: boolean, ac: boolean) => {
  state.member = { allowed: member, isPending: false };
  state.ac = { allowed: ac, isPending: false };
  navigate.mockClear();
};

describe("settings route guard", () => {
  it("does not redirect while the permission check is still pending", () => {
    state.member = { allowed: false, isPending: true };
    state.ac = { allowed: false, isPending: true };
    navigate.mockClear();
    render(<Settings />);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByText("Einstellungen")).toBeNull();
  });

  it("redirects away once both checks settle as denied", () => {
    settle(false, false);
    render(<Settings />);
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("admits a caller whose right comes only from a dynamic group grant", () => {
    // No static member:update — only ac:create, which a group can grant.
    settle(false, true);
    render(<Settings />);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Einstellungen")).toBeDefined();
    expect(screen.getByText("outlet")).toBeDefined();
  });

  it("admits a caller with member management rights", () => {
    settle(true, false);
    render(<Settings />);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Mitglieder")).toBeDefined();
  });
});
