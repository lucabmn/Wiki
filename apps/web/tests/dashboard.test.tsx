import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: {
    overview: undefined as Record<string, number> | undefined,
    activity: [] as unknown[],
    favorites: [] as unknown[],
  },
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { session: { activeOrganizationId: "o1" } } }) },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useRouteContext: () => ({
      auth: {
        organization: { name: "Acme", members: [{}, {}] },
        session: { user: { name: "Luca" } },
      },
    }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    dashboard: {
      overview: {
        queryOptions: () => ({ queryKey: ["overview"], queryFn: async () => data.overview }),
      },
    },
    activity: {
      list: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["activity"],
          queryFn: async () => data.activity,
          enabled,
        }),
      },
    },
    me: {
      listFavorites: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["favs"],
          queryFn: async () => data.favorites,
          enabled,
        }),
      },
    },
    spaces: {
      list: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["spaces"],
          queryFn: async () => [],
          enabled,
        }),
      },
    },
    pages: {
      create: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: async () => ({}),
          ...opts,
        }),
      },
      list: { key: () => ["pages"] },
    },
  },
}));

import { Route } from "@/routes/_auth/index";

const Dashboard = (Route as unknown as { component: () => ReactNode }).component;

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  data.overview = undefined;
  data.activity = [];
  data.favorites = [];
});

describe("dashboard hero", () => {
  it("renders the real stats and their weekly deltas", async () => {
    data.overview = {
      pageCount: 12,
      pagesCreatedThisWeek: 3,
      openComments: 4,
      commentsResolvedThisWeek: 5,
      activeMembersThisWeek: 6,
    };
    renderDashboard();

    // Headline counts (members total = 2 comes from the auth context).
    expect(await screen.findByText("12")).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    // Weekly deltas built from the companion counts.
    expect(screen.getByText("+3 diese Woche")).toBeDefined();
    expect(screen.getByText("6 aktiv diese Woche")).toBeDefined();
    expect(screen.getByText("5 gelöst diese Woche")).toBeDefined();
    // Greeting line carries the user's name.
    expect(screen.getByText(/, Luca\./)).toBeDefined();
    // Prose summary uses real numbers.
    expect(
      screen.getByText("Du hast 4 offene Kommentare und 3 neue Seiten diese Woche."),
    ).toBeDefined();
  });

  it("shows empty states for activity and favorites", async () => {
    data.overview = {
      pageCount: 0,
      pagesCreatedThisWeek: 0,
      openComments: 0,
      commentsResolvedThisWeek: 0,
      activeMembersThisWeek: 0,
    };
    renderDashboard();
    expect(await screen.findByText("Noch keine Favoriten.")).toBeDefined();
  });
});
