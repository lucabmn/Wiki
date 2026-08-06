import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: { spaces: [] as unknown[], pages: [] as unknown[], role: "viewer" },
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The create/settings dialogs pull their own mutations — out of scope here.
vi.mock("@/components/create-space-dialog", () => ({ CreateSpaceDialog: () => null }));
vi.mock("@/components/create-page-dialog", () => ({ CreatePageDialog: () => null }));
vi.mock("@/components/html-import-dialog", () => ({ HtmlImportDialog: () => null }));
vi.mock("@/components/spaces/space-settings-sheet", () => ({ SpaceSettingsSheet: () => null }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ slug: "ops" }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  // The browse route reads the auth context off the _auth layout route by id.
  useRouteContext: () => ({
    auth: {
      organization: { id: "o1", members: [] },
      session: { user: { name: "Luca", email: "luca@acme.io" } },
    },
  }),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    spaces: {
      list: {
        queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }),
        key: () => ["spaces"],
      },
    },
    pages: {
      key: () => ["pages"],
      tree: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["page-tree"],
          queryFn: async () => data.pages,
          enabled,
        }),
        key: () => ["page-tree"],
      },
      list: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["pages"],
          queryFn: async () => data.pages,
          enabled,
        }),
        key: () => ["pages"],
      },
    },
    spaceMembers: {
      myRole: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["myRole"],
          queryFn: async () => ({ role: data.role }),
          enabled,
        }),
        key: () => ["myRole"],
      },
    },
  },
}));

import { Route as BrowseRoute } from "@/routes/_auth/spaces/$slug";
import { Route as IndexRoute } from "@/routes/_auth/spaces";

const SpaceBrowse = (BrowseRoute as unknown as { component: () => ReactNode }).component;
const SpacesIndex = (IndexRoute as unknown as { component: () => ReactNode }).component;

function renderComponent(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  data.spaces = [];
  data.pages = [];
  data.role = "viewer";
});

describe("spaces index route", () => {
  it("lists spaces you can read", async () => {
    data.spaces = [
      {
        id: "s1",
        slug: "ops",
        name: "Operations",
        visibility: "public",
        color: null,
        icon: null,
        description: "Runbooks",
      },
      {
        id: "s2",
        slug: "hr",
        name: "People",
        visibility: "private",
        color: null,
        icon: null,
        description: null,
      },
    ];
    renderComponent(<SpacesIndex />);
    expect(await screen.findByText("Operations")).toBeDefined();
    expect(screen.getByText("People")).toBeDefined();
    expect(screen.getByText("Runbooks")).toBeDefined();
  });

  it("shows an empty state", async () => {
    renderComponent(<SpacesIndex />);
    expect(await screen.findByText("Noch keine Spaces")).toBeDefined();
  });
});

describe("space browse route", () => {
  it("renders the matching space header and its pages", async () => {
    data.spaces = [
      {
        id: "s1",
        slug: "ops",
        name: "Operations",
        visibility: "restricted",
        color: null,
        icon: null,
        description: "Runbooks",
        createdBy: null,
        createdAt: new Date("2026-01-02T10:00:00Z"),
      },
    ];
    data.pages = [
      { id: "p1", title: "Deploy", icon: null, status: "published" },
      { id: "p2", title: "Rollback", icon: "🔙", status: "published" },
    ];
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByText("Operations")).toBeDefined();
    // Visibility shows in both the header badge and the info rail.
    expect(screen.getAllByText("Eingeschränkt").length).toBeGreaterThan(0);
    // Pages load after the space resolves.
    expect(await screen.findByText("Deploy")).toBeDefined();
    expect(screen.getByText("Rollback")).toBeDefined();
  });

  it("shows a not-found state when the slug has no readable space", async () => {
    data.spaces = [
      {
        id: "s9",
        slug: "other",
        name: "Other",
        visibility: "public",
        color: null,
        icon: null,
        description: null,
        createdBy: null,
        createdAt: new Date("2026-01-02T10:00:00Z"),
      },
    ];
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByText("Space nicht gefunden")).toBeDefined();
  });

  it("offers HTML migration only to space editors and admins", async () => {
    data.spaces = [
      {
        id: "s1",
        slug: "ops",
        name: "Operations",
        visibility: "public",
        color: null,
        icon: null,
        description: null,
        createdBy: null,
        createdAt: new Date("2026-01-02T10:00:00Z"),
      },
    ];
    data.role = "editor";
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByRole("button", { name: "HTML importieren" })).toBeDefined();
  });

  it("shows an empty-pages hint", async () => {
    data.spaces = [
      {
        id: "s1",
        slug: "ops",
        name: "Operations",
        visibility: "public",
        color: null,
        icon: null,
        description: null,
        createdBy: null,
        createdAt: new Date("2026-01-02T10:00:00Z"),
      },
    ];
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByText("Noch keine Seiten")).toBeDefined();
  });
});
