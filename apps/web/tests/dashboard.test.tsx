import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: {
    overview: undefined as Record<string, number> | undefined,
    spaces: [] as unknown[],
    // The org-wide feed and the caller's own feed are separate queries; the
    // mock below routes by `actorId`, like the real endpoint does.
    activity: [] as unknown[],
    myActivity: [] as unknown[],
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
        session: { user: { id: "u1", name: "Luca" } },
      },
    }),
    ...opts,
  }),
  Link: ({
    children,
    to,
    params: _params,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
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
        // Key on the input so the two activity queries don't share a cache entry.
        queryOptions: ({ input }: { input: { actorId?: string; limit: number } }) => ({
          queryKey: ["activity", input],
          queryFn: async () => (input.actorId ? data.myActivity : data.activity),
        }),
      },
    },
    me: {
      listFavorites: {
        queryOptions: () => ({ queryKey: ["favs"], queryFn: async () => data.favorites }),
      },
    },
    spaces: {
      list: {
        queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }),
      },
    },
    pages: {
      key: () => ["pages"],
      create: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: async () => ({}),
          ...opts,
        }),
      },
      createFromTemplate: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: async () => ({}),
          ...opts,
        }),
      },
      listTemplates: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["templates"],
          queryFn: async () => [],
          enabled,
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

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

function activityRow(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    action: "page.updated",
    pageId: "p1",
    metadata: { title: "Onboarding" },
    createdAt: minutesAgo(30),
    actor: { name: "Luca" },
    space: { name: "Handbuch", color: "#2563eb" },
    ...overrides,
  };
}

beforeEach(() => {
  data.overview = {
    pageCount: 0,
    pagesCreatedThisWeek: 0,
    openComments: 0,
    commentsResolvedThisWeek: 0,
    activeMembersThisWeek: 0,
  };
  data.spaces = [];
  data.activity = [];
  data.myActivity = [];
  data.favorites = [];
});

describe("dashboard header", () => {
  it("names the organization and sums up its content", async () => {
    data.overview = {
      pageCount: 12,
      pagesCreatedThisWeek: 3,
      openComments: 4,
      commentsResolvedThisWeek: 5,
      activeMembersThisWeek: 6,
    };
    data.spaces = [{ id: "s1" }, { id: "s2" }];
    renderDashboard();

    expect(screen.getByText("Acme")).toBeDefined();
    expect(await screen.findByText("12 Seiten · 2 Spaces · 4 offene Kommentare")).toBeDefined();
  });

  it("uses singular wording for single counts", async () => {
    data.overview = {
      pageCount: 1,
      pagesCreatedThisWeek: 0,
      openComments: 1,
      commentsResolvedThisWeek: 0,
      activeMembersThisWeek: 0,
    };
    data.spaces = [{ id: "s1" }];
    renderDashboard();

    expect(await screen.findByText("1 Seite · 1 Space · 1 offener Kommentar")).toBeDefined();
  });
});

describe("activity feed", () => {
  it("shows what changed, who changed it and when, grouped by day", async () => {
    data.activity = [
      activityRow({ id: "a1", metadata: { title: "Onboarding" } }),
      activityRow({
        id: "a2",
        action: "comment.created",
        pageId: "p2",
        metadata: { commentId: "c1" },
        actor: { name: "Mara" },
      }),
    ];
    renderDashboard();

    // The page title is the headline — not the bare action label.
    expect(await screen.findByText("Onboarding")).toBeDefined();
    expect(screen.getByText(/^Luca · Seite bearbeitet · /)).toBeDefined();
    // A row without a subject falls back to the action label.
    expect(screen.getByText("Kommentar hinzugefügt")).toBeDefined();
    expect(screen.getByText("Heute")).toBeDefined();
    // Rows link to their page.
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/pages/$id")).toBe(
      true,
    );
  });

  it("shows an empty state when nothing has happened yet", async () => {
    renderDashboard();
    expect(await screen.findByText("Noch nichts passiert")).toBeDefined();
  });
});

describe("weiter bearbeiten", () => {
  it("lists the caller's most recent pages, one card per page", async () => {
    data.myActivity = [
      activityRow({ id: "m1", pageId: "p1", metadata: { title: "Onboarding" } }),
      // Same page again — must not produce a second card.
      activityRow({ id: "m2", pageId: "p1", metadata: { title: "Onboarding" } }),
      activityRow({
        id: "m3",
        pageId: "p2",
        action: "page.created",
        metadata: { title: "Urlaubsantrag" },
      }),
    ];
    renderDashboard();

    expect(await screen.findByText("Urlaubsantrag")).toBeDefined();
    expect(screen.getByText("Weiter bearbeiten")).toBeDefined();
    expect(screen.getAllByText("Onboarding")).toHaveLength(1);
  });

  it("is hidden entirely when the caller has not edited anything", async () => {
    renderDashboard();
    expect(await screen.findByText("Keine Favoriten")).toBeDefined();
    expect(screen.queryByText("Weiter bearbeiten")).toBeNull();
  });
});

describe("favorites", () => {
  it("links each favorite page", async () => {
    data.favorites = [{ id: "p9", title: "Reisekosten", icon: null }];
    renderDashboard();
    expect(await screen.findByText("Reisekosten")).toBeDefined();
  });

  it("explains how to add one when there are none", async () => {
    renderDashboard();
    expect(await screen.findByText(/Markiere eine Seite mit dem Stern/)).toBeDefined();
  });
});
