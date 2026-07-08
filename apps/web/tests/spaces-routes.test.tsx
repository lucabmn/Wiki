import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: { spaces: [] as unknown[], pages: [] as unknown[] },
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ slug: "ops" }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    spaces: {
      list: {
        queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }),
      },
    },
    pages: {
      list: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["pages"],
          queryFn: async () => data.pages,
          enabled,
        }),
      },
    },
  },
}));

import { Route as BrowseRoute } from "@/routes/_auth/spaces.$slug";
import { Route as IndexRoute } from "@/routes/_auth/spaces.index";

const SpaceBrowse = (BrowseRoute as unknown as { component: () => ReactNode }).component;
const SpacesIndex = (IndexRoute as unknown as { component: () => ReactNode }).component;

function renderComponent(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  data.spaces = [];
  data.pages = [];
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
    expect(await screen.findByText("Noch keine Spaces.")).toBeDefined();
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
      },
    ];
    data.pages = [
      { id: "p1", title: "Deploy", icon: null },
      { id: "p2", title: "Rollback", icon: "🔙" },
    ];
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByText("Operations")).toBeDefined();
    expect(screen.getByText("Eingeschränkt")).toBeDefined();
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
      },
    ];
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByText("Space nicht gefunden")).toBeDefined();
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
      },
    ];
    renderComponent(<SpaceBrowse />);
    expect(await screen.findByText("Noch keine Seiten in diesem Space.")).toBeDefined();
  });
});
