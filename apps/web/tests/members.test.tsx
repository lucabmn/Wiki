import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { members } = vi.hoisted(() => ({ members: [] as unknown[] }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useRouteContext: () => ({ auth: { organization: { id: "o1", name: "Acme" } } }),
    ...opts,
  }),
}));

// Drive each org query off its queryKey so the members table renders from the
// hoisted fixture; roles/invitations stay empty.
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const kind = opts.queryKey[1];
    if (kind === "members") return { data: { members, total: members.length }, isPending: false };
    return { data: [], isPending: false };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/org-queries", () => ({
  membersQueryOptions: (id: string) => ({ queryKey: ["organization", "members", id] }),
  invitationsQueryOptions: (id: string) => ({ queryKey: ["organization", "invitations", id] }),
  rolesQueryOptions: (id: string) => ({ queryKey: ["organization", "roles", id] }),
  useOrgRefresh: () => async () => {},
}));

// Dialogs pull their own better-auth wiring — out of scope for the table render.
vi.mock("@/components/settings/invite-member-dialog", () => ({ InviteMemberDialog: () => null }));
vi.mock("@/components/settings/member-roles-dialog", () => ({ MemberRolesDialog: () => null }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

import { Route } from "@/routes/_auth/settings/members";

const Members = (Route as unknown as { component: () => ReactNode }).component;

describe("members settings route", () => {
  it("lists members with their roles", () => {
    members.length = 0;
    members.push(
      { id: "m1", role: "owner", user: { name: "Luca Braun", email: "luca@acme.io" } },
      { id: "m2", role: "member", user: { name: "Mia Kern", email: "mia@acme.io" } },
    );
    render(<Members />);

    expect(screen.getByText("2 Mitglieder in Acme.")).toBeDefined();
    expect(screen.getByText("Luca Braun")).toBeDefined();
    expect(screen.getByText("luca@acme.io")).toBeDefined();
    expect(screen.getByText("Inhaber")).toBeDefined();
    expect(screen.getByText("Mia Kern")).toBeDefined();
    expect(screen.getByText("Mitglied")).toBeDefined();
  });

  it("renders combined static and group roles as separate badges", () => {
    members.length = 0;
    members.push({
      id: "m1",
      role: "admin,redaktion",
      user: { name: "Solo Dev", email: "solo@acme.io" },
    });
    render(<Members />);

    expect(screen.getByText("1 Mitglied in Acme.")).toBeDefined();
    expect(screen.getByText("Administrator")).toBeDefined();
    // A dynamic group name has no static label, so it renders verbatim.
    expect(screen.getByText("redaktion")).toBeDefined();
  });
});
