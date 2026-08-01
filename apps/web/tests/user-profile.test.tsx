import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: {
    profile: undefined as Record<string, unknown> | undefined,
    pagesByKind: {} as Record<string, unknown[]>,
    activity: [] as unknown[],
    users: [] as unknown[],
  },
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ id: "u2" }),
    useRouteContext: () => ({ auth: { session: { user: { id: "u1" } } } }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    users: {
      get: { queryOptions: () => ({ queryKey: ["profile"], queryFn: async () => data.profile }) },
      list: { queryOptions: () => ({ queryKey: ["users"], queryFn: async () => data.users }) },
      pages: {
        queryOptions: ({ input }: { input: { kind: string } }) => ({
          queryKey: ["pages", input.kind],
          queryFn: async () => data.pagesByKind[input.kind] ?? [],
        }),
      },
    },
    activity: {
      list: {
        queryOptions: () => ({ queryKey: ["activity"], queryFn: async () => data.activity }),
      },
    },
  },
}));

import { Route as ProfileRoute } from "@/routes/_auth/users/$id";
import { Route as DirectoryRoute } from "@/routes/_auth/users/index";

const Profile = (ProfileRoute as unknown as { component: () => ReactNode }).component;
const Directory = (DirectoryRoute as unknown as { component: () => ReactNode }).component;

function renderRoute(Component: () => ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  data.profile = undefined;
  data.pagesByKind = {};
  data.activity = [];
  data.users = [];
});

describe("user profile", () => {
  it("renders identity, roles and contribution counts", async () => {
    data.profile = {
      id: "u2",
      name: "Ada Lovelace",
      email: "ada@x.io",
      // Exercises the <AvatarImage> branch; the null case is covered below.
      image: "https://cdn.example/ada.png",
      roles: ["owner"],
      joinedAt: new Date("2026-01-15T10:00:00Z"),
      createdAt: new Date("2026-01-15T10:00:00Z"),
      stats: {
        pagesCreated: 7,
        pagesEdited: 12,
        comments: 3,
        spacesContributed: 2,
        lastActiveAt: new Date(),
      },
    };
    data.pagesByKind.created = [
      {
        id: "p1",
        title: "Onboarding",
        icon: null,
        status: "published",
        spaceId: "s1",
        spaceName: "Handbuch",
        spaceColor: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    renderRoute(Profile);

    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.getByText("ada@x.io")).toBeDefined();
    expect(screen.getByText("Inhaber")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText(/Mitglied seit 15\. Januar 2026/)).toBeDefined();
    expect(await screen.findByText("Onboarding")).toBeDefined();
    // Base UI only swaps the <img> in once it has loaded, which never happens
    // in jsdom — so this asserts the graceful degradation: a profile carrying an
    // image URL still renders, falling back to the initials.
    expect(screen.getByText("AL")).toBeDefined();
  });

  it("explains an empty contribution list in terms of the viewer's access", async () => {
    data.profile = {
      id: "u2",
      name: "Ada",
      email: "ada@x.io",
      image: null,
      roles: [],
      joinedAt: new Date(),
      createdAt: new Date(),
      stats: {
        pagesCreated: 0,
        pagesEdited: 0,
        comments: 0,
        spacesContributed: 0,
        lastActiveAt: null,
      },
    };
    renderRoute(Profile);

    expect(
      await screen.findByText("Ada hat noch keine Seite erstellt, die du sehen kannst."),
    ).toBeDefined();
    expect(screen.getByText(/noch keine Aktivität/)).toBeDefined();
  });
});

describe("people directory", () => {
  it("lists every member of the organization", async () => {
    data.users = [
      {
        id: "u1",
        name: "Ada",
        email: "ada@x.io",
        image: null,
        roles: ["admin"],
        joinedAt: new Date(),
      },
      {
        id: "u2",
        name: "Grace",
        email: "grace@x.io",
        image: null,
        roles: [],
        joinedAt: new Date(),
      },
    ];
    renderRoute(Directory);

    expect(await screen.findByText("Ada")).toBeDefined();
    expect(screen.getByText("Grace")).toBeDefined();
    expect(screen.getByText("2 Mitglieder in dieser Organisation.")).toBeDefined();
  });
});
