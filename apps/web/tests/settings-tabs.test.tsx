import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Smoke coverage for the settings tabs: each one is rendered once to prove it
// mounts. Typecheck cannot catch a hook that exists in the client's *types* but
// not at runtime (`useListPasskeys` is atom-derived, not path-derived), nor a
// Base UI prop the component passes wrongly — both surface as a white screen.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useRouteContext: () => ({
      auth: {
        organization: { id: "o1", name: "Acme", slug: "acme", logo: null },
        session: { user: { id: "u1" } },
      },
    }),
    ...opts,
  }),
  useRouter: () => ({ invalidate: async () => {}, navigate: async () => {} }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isPending: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Gating is covered in settings-guard.test.tsx; here it would only stand between
// the test and the component under test.
vi.mock("@/components/settings/permission-gate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/org-queries", () => ({
  membersQueryOptions: () => ({ queryKey: ["organization", "members"] }),
  teamsQueryOptions: () => ({ queryKey: ["organization", "teams"] }),
  teamMembersQueryOptions: () => ({ queryKey: ["organization", "teamMembers"] }),
  useOrgRefresh: () => async () => {},
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: "u1",
          name: "Luca Braun",
          email: "luca@acme.io",
          emailVerified: false,
          twoFactorEnabled: false,
        },
        session: { token: "sess_1" },
      },
      isPending: false,
    }),
    useListPasskeys: () => ({ data: [], isPending: false }),
    listSessions: async () => ({ data: [], error: null }),
  },
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "system", setTheme: () => {} }),
}));

import { Route as AppearanceRoute } from "@/routes/_auth/settings/appearance";
import { Route as OrganizationRoute } from "@/routes/_auth/settings/organization";
import { Route as ProfileRoute } from "@/routes/_auth/settings/profile";
import { Route as SecurityRoute } from "@/routes/_auth/settings/security";
import { Route as TeamsRoute } from "@/routes/_auth/settings/teams";

const componentOf = (route: unknown) => (route as { component: () => ReactNode }).component;

describe("settings tabs render", () => {
  it("profile", () => {
    const Profile = componentOf(ProfileRoute);
    render(<Profile />);

    expect(screen.getByText("Profil")).toBeDefined();
    expect(screen.getByText("E-Mail-Adresse")).toBeDefined();
    // Seeded from the session, not left blank.
    expect(screen.getByLabelText("Anzeigename")).toHaveProperty("value", "Luca Braun");
  });

  it("security", () => {
    const Security = componentOf(SecurityRoute);
    render(<Security />);

    expect(screen.getByText("Passwort")).toBeDefined();
    expect(screen.getByText("Zwei-Faktor-Authentifizierung")).toBeDefined();
    expect(screen.getByText("Passkeys")).toBeDefined();
    expect(screen.getByText("Aktive Sitzungen")).toBeDefined();
  });

  it("appearance", () => {
    const Appearance = componentOf(AppearanceRoute);
    render(<Appearance />);

    expect(screen.getByText("Erscheinungsbild")).toBeDefined();
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("organization", () => {
    const Organization = componentOf(OrganizationRoute);
    render(<Organization />);

    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Acme");
    expect(screen.getByLabelText("Kurzname (Slug)")).toHaveProperty("value", "acme");
  });

  it("teams", () => {
    const Teams = componentOf(TeamsRoute);
    render(<Teams />);

    expect(screen.getByText("Teams")).toBeDefined();
    expect(screen.getByText("Noch keine Teams")).toBeDefined();
  });
});
