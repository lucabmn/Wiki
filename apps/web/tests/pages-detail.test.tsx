import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  data,
  createCommentSpy,
  addFavoriteSpy,
  resolveSpy,
  subscribeSpy,
  deleteCommentSpy,
  archiveSpy,
  navigateSpy,
} = vi.hoisted(() => ({
  data: {
    page: undefined as unknown,
    comments: [] as unknown[],
    spaces: [] as unknown[],
    favorites: [] as Array<{ id: string }>,
    subscriptions: [] as Array<{ id: string }>,
    canEdit: false,
    error: false,
  },
  createCommentSpy: vi.fn((_vars?: { pageId: string; body: string }) => Promise.resolve({})),
  addFavoriteSpy: vi.fn((_vars?: { pageId: string }) => Promise.resolve({})),
  resolveSpy: vi.fn((_vars?: { id: string; resolved: boolean }) => Promise.resolve({})),
  subscribeSpy: vi.fn((_vars?: { pageId: string }) => Promise.resolve({})),
  deleteCommentSpy: vi.fn((_vars?: { id: string }) => Promise.resolve({})),
  archiveSpy: vi.fn((_vars?: { id: string }) => Promise.resolve({})),
  navigateSpy: vi.fn(),
}));

// Passthrough the layout so the sidebar (and its many deps) stays out of scope.
vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Drive the client-side permission gate directly; its real impl reads better-auth.
vi.mock("@/lib/permissions", () => ({ usePermission: () => data.canEdit }));

// Stub the editor — its TipTap internals are covered in page-editor.test.tsx;
// here we only assert the route toggles into/out of edit mode.
vi.mock("@/components/editor/page-editor", () => ({
  PageEditor: ({ onDone }: { onDone: () => void }) => (
    <div>
      <span>EDITOR AKTIV</span>
      <button type="button" onClick={onDone}>
        Editor schließen
      </button>
    </div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ id: "p1" }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigateSpy,
  useRouteContext: () => ({
    auth: {
      organization: {
        members: [{ user: { id: "u1", name: "Luca" } }],
      },
    },
  }),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      get: {
        queryOptions: ({ input }: { input: { id: string } }) => ({
          queryKey: ["page", input.id],
          queryFn: async () => {
            if (data.error) throw new Error("nope");
            return data.page;
          },
        }),
      },
      archive: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: archiveSpy, ...opts }),
      },
      list: { key: () => ["pages"] },
    },
    comments: {
      list: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["comments"],
          queryFn: async () => data.comments,
          enabled,
        }),
        key: () => ["comments"],
      },
      create: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: createCommentSpy,
          ...opts,
        }),
      },
      resolve: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: resolveSpy, ...opts }),
      },
      delete: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: deleteCommentSpy,
          ...opts,
        }),
      },
    },
    me: {
      listFavorites: {
        queryOptions: () => ({ queryKey: ["favs"], queryFn: async () => data.favorites }),
        key: () => ["favs"],
      },
      addFavorite: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: addFavoriteSpy,
          ...opts,
        }),
      },
      removeFavorite: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...opts }),
      },
      listSubscriptions: {
        queryOptions: () => ({ queryKey: ["subs"], queryFn: async () => data.subscriptions }),
        key: () => ["subs"],
      },
      subscribe: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: subscribeSpy, ...opts }),
      },
      unsubscribe: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...opts }),
      },
    },
    spaces: {
      list: {
        queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }),
      },
    },
  },
}));

import { Route } from "@/routes/_auth/pages/$id";

const PageView = (Route as unknown as { component: () => ReactNode }).component;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PageView />
    </QueryClientProvider>,
  );
}

describe("page view route", () => {
  beforeEach(() => {
    data.page = undefined;
    data.comments = [];
    data.spaces = [];
    data.favorites = [];
    data.subscriptions = [];
    data.canEdit = false;
    data.error = false;
  });

  const somePage = {
    id: "p1",
    spaceId: "s1",
    title: "Blank",
    slug: "blank",
    icon: null,
    status: "draft",
    textContent: "body",
    updatedAt: new Date("2026-01-02T10:00:00Z"),
  };

  it("renders title, content, back-link and comments", async () => {
    data.page = {
      id: "p1",
      spaceId: "s1",
      title: "Runbook",
      slug: "runbook",
      icon: null,
      status: "published",
      textContent: "Restart the pods.",
      updatedAt: new Date("2026-01-02T10:00:00Z"),
    };
    data.spaces = [{ id: "s1", slug: "ops", name: "Operations", visibility: "public" }];
    data.comments = [
      {
        id: "c1",
        body: "Works",
        resolvedAt: null,
        deletedAt: null,
        createdAt: new Date("2026-01-02T11:00:00Z"),
      },
      {
        id: "c2",
        body: "resolved one",
        resolvedAt: new Date(),
        deletedAt: null,
        createdAt: new Date(),
      },
    ];
    renderView();

    expect(await screen.findByText("Runbook")).toBeDefined();
    expect(screen.getByText("Restart the pods.")).toBeDefined();
    // Status shows in both the header badge and the metadata rail.
    expect(screen.getAllByText("Veröffentlicht").length).toBeGreaterThan(0);
    expect(screen.getByText("← Operations")).toBeDefined();
    // Only the unresolved comment counts (comments load after the page).
    expect(await screen.findByRole("heading", { name: "Kommentare (1)" })).toBeDefined();
    expect(screen.getByText("Works")).toBeDefined();
    expect(screen.queryByText("resolved one")).toBeNull();
  });

  it("shows an empty-content hint when the page has no text", async () => {
    data.page = {
      id: "p1",
      spaceId: "s1",
      title: "Blank",
      slug: "blank",
      icon: null,
      status: "draft",
      textContent: "   ",
      updatedAt: new Date("2026-01-02T10:00:00Z"),
    };
    renderView();

    expect(await screen.findByText("Diese Seite hat noch keinen Inhalt.")).toBeDefined();
    expect(screen.getByText("Noch keine Kommentare.")).toBeDefined();
  });

  it("shows a not-found state when the page errors", async () => {
    data.error = true;
    renderView();
    expect(await screen.findByText("Seite nicht gefunden")).toBeDefined();
  });

  it("submits a new comment", async () => {
    data.page = {
      id: "p1",
      spaceId: "s1",
      title: "Blank",
      slug: "blank",
      icon: null,
      status: "draft",
      textContent: "body",
      updatedAt: new Date("2026-01-02T10:00:00Z"),
    };
    renderView();

    const textarea = await screen.findByPlaceholderText("Kommentar schreiben …");
    fireEvent.change(textarea, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Kommentieren" }));

    await waitFor(() =>
      expect(createCommentSpy.mock.calls[0]?.[0]).toEqual({ pageId: "p1", body: "Looks good" }),
    );
  });

  it("adds the page to favorites", async () => {
    data.page = somePage;
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Merken" }));
    await waitFor(() => expect(addFavoriteSpy.mock.calls[0]?.[0]).toEqual({ pageId: "p1" }));
  });

  it("reflects an already-favorited page", async () => {
    data.page = somePage;
    data.favorites = [{ id: "p1" }];
    renderView();
    expect(await screen.findByRole("button", { name: "Favorit" })).toBeDefined();
  });

  it("resolves a comment", async () => {
    data.page = somePage;
    data.comments = [
      { id: "c1", body: "Q", resolvedAt: null, deletedAt: null, createdAt: new Date() },
    ];
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Auflösen" }));
    await waitFor(() =>
      expect(resolveSpy.mock.calls[0]?.[0]).toEqual({ id: "c1", resolved: true }),
    );
  });

  it("deletes a comment", async () => {
    data.page = somePage;
    data.comments = [
      { id: "c1", body: "Q", resolvedAt: null, deletedAt: null, createdAt: new Date() },
    ];
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Kommentar löschen" }));
    await waitFor(() => expect(deleteCommentSpy.mock.calls[0]?.[0]).toEqual({ id: "c1" }));
  });

  it("subscribes to the page", async () => {
    data.page = somePage;
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Abonnieren" }));
    await waitFor(() => expect(subscribeSpy.mock.calls[0]?.[0]).toEqual({ pageId: "p1" }));
  });

  it("reflects an already-subscribed page", async () => {
    data.page = somePage;
    data.subscriptions = [{ id: "p1" }];
    renderView();
    expect(await screen.findByRole("button", { name: "Abonniert" })).toBeDefined();
  });

  it("archives the page after confirming and returns to the space", async () => {
    data.page = somePage;
    data.spaces = [{ id: "s1", slug: "ops", name: "Operations", visibility: "public" }];
    renderView();

    // Open the confirm dialog, then confirm inside it.
    fireEvent.click(await screen.findByRole("button", { name: "Archivieren" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archivieren" }));

    await waitFor(() => expect(archiveSpy.mock.calls[0]?.[0]).toEqual({ id: "p1" }));
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/spaces/$slug", params: { slug: "ops" } }),
    );
  });

  it("hides the edit affordance without update permission", async () => {
    data.page = somePage;
    data.canEdit = false;
    renderView();
    await screen.findByText("body");
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
  });

  it("opens and closes the editor when permitted", async () => {
    data.page = somePage;
    data.canEdit = true;
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect(await screen.findByText("EDITOR AKTIV")).toBeDefined();
    // View chrome (comment box) is replaced by the editor surface.
    expect(screen.queryByPlaceholderText("Kommentar schreiben …")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Editor schließen" }));
    expect(await screen.findByText("body")).toBeDefined();
    expect(screen.queryByText("EDITOR AKTIV")).toBeNull();
  });
});
