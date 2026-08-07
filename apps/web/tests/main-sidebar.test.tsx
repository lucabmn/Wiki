import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SidebarProvider } from "@nilovon-wiki/ui/components/sidebar";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateSpy, data } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  data: { spaces: [] as unknown[], pages: [] as unknown[] },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { session: { activeOrganizationId: "o1" } } }),
    useActiveMember: () => ({ data: undefined }),
    useListOrganizations: () => ({ data: [{ id: "o1", name: "Org Eins" }] }),
    organization: { setActive: async () => ({}) },
    signOut: async () => ({}),
  },
}));
// The sidebar's permission gates round-trip to better-auth in the real impl;
// drive them directly here so no organization queries are needed.
vi.mock("@/lib/permissions", () => ({
  usePermission: () => ({ allowed: false, isPending: false }),
  checkStaticRolePermission: () => false,
}));
// Alias paths so these resolve to the same module id MainSidebar imports via
// "./…" — a relative specifier here would resolve against the test file.
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));
// Children pull their own queries/dialogs — out of scope for the sidebar test.
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/create-space-dialog", () => ({ CreateSpaceDialog: () => null }));
vi.mock("@/components/create-page-dialog", () => ({ CreatePageDialog: () => null }));
vi.mock("@/components/inbox/notification-bell", () => ({ NotificationBell: () => null }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateSpy,
  useMatchRoute: () => () => false,
  // The sidebar reads the auth context off the _auth layout route by id.
  useRouteContext: () => ({
    auth: {
      organization: { name: "Acme", members: [] },
      session: { user: { name: "Luca", email: "luca@acme.io" } },
    },
  }),
  linkOptions: (x: unknown) => x,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to?: string;
    params?: { slug?: string };
    children: ReactNode;
  }) => (
    <a data-to={to} data-slug={params?.slug} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    spaces: {
      list: { queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }) },
    },
    pages: {
      key: () => ["pages"],
      tree: {
        queryOptions: () => ({ queryKey: ["page-tree"], queryFn: async () => data.pages }),
        key: () => ["page-tree"],
      },
      list: {
        queryOptions: () => ({ queryKey: ["pages"], queryFn: async () => data.pages }),
        key: () => ["pages"],
      },
      move: { mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...o }) },
    },
  },
}));

import MainSidebar from "@/components/main-sidebar";

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <MainSidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  data.spaces = [
    { id: "s1", slug: "ops", name: "Operations", color: null, icon: null },
    { id: "s2", slug: "hr", name: "People", color: null, icon: null },
  ];
  data.pages = [{ id: "p1", parentId: null, title: "Deploy", icon: null }];
  window.localStorage.clear();
});

describe("MainSidebar", () => {
  it("renders each space name as a link to its browse route", async () => {
    renderSidebar();
    const ops = await screen.findByText("Operations");
    expect(ops.closest("a")?.getAttribute("data-slug")).toBe("ops");
    expect(screen.getByText("People").closest("a")?.getAttribute("data-slug")).toBe("hr");
  });

  it("keeps a separate collapse toggle per space", async () => {
    renderSidebar();
    await screen.findByText("Operations");
    // The chevron trigger is split out from the navigating name.
    expect(screen.getAllByTitle("Ein-/ausklappen")).toHaveLength(2);
  });

  it("navigates to the page view when a page in the tree is clicked", async () => {
    renderSidebar();
    const page = (await screen.findAllByText("Deploy"))[0];
    fireEvent.click(page);
    expect(navigateSpy).toHaveBeenCalledWith({ to: "/pages/$id", params: { id: "p1" } });
  });

  // Base UI throws "MenuGroupContext is missing" when a GroupLabel mounts
  // outside a Menu.Group, and only once the menu content actually mounts.
  it("mounts the org switcher menu content", async () => {
    renderSidebar();
    fireEvent.click(await screen.findByText("Acme"));
    expect(await screen.findByText("Organisation wechseln")).toBeDefined();
    expect(screen.getByText("Org Eins")).toBeDefined();
  });

  it("mounts the user menu content", async () => {
    renderSidebar();
    fireEvent.click((await screen.findAllByText("Luca"))[0]);
    expect(await screen.findByText("Abmelden")).toBeDefined();
    // Once open the email shows twice: the trigger and the menu's group label.
    expect(screen.getAllByText("luca@acme.io")).toHaveLength(2);
  });

  it("persists collapsed spaces before rendering the tree", async () => {
    window.localStorage.setItem(
      "nilovon-wiki:sidebar:space-open-state:o1",
      JSON.stringify({ s1: false }),
    );

    renderSidebar();

    await screen.findByText("Operations");
    expect(screen.queryByText("Deploy")).toBeNull();
  });

  it("stores collapse changes per organization", async () => {
    renderSidebar();
    await screen.findByText("Operations");

    fireEvent.click(screen.getAllByTitle("Ein-/ausklappen")[0]);

    await waitFor(() => {
      expect(window.localStorage.getItem("nilovon-wiki:sidebar:space-open-state:o1")).toBe(
        JSON.stringify({ s1: false }),
      );
    });
  });

  it("does not crash when a collapse toggle is clicked", async () => {
    renderSidebar();
    await screen.findByText("Operations");
    fireEvent.click(screen.getAllByTitle("Ein-/ausklappen")[1]);
    expect(screen.getByText("Operations")).toBeDefined();
  });
});
