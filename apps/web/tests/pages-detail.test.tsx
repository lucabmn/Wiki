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
  updateSpy,
  createFromTemplateSpy,
  restorePageSpy,
  deletePageSpy,
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
    // The effective deletion block for this page, as `legalHolds.status` reports it.
    hold: { held: false, source: "none", reason: null, holdId: null } as {
      held: boolean;
      source: string;
      reason: string | null;
      holdId: string | null;
    },
  },
  createCommentSpy: vi.fn((_vars?: { pageId: string; body: string }) => Promise.resolve({})),
  addFavoriteSpy: vi.fn((_vars?: { pageId: string }) => Promise.resolve({})),
  resolveSpy: vi.fn((_vars?: { id: string; resolved: boolean }) => Promise.resolve({})),
  subscribeSpy: vi.fn((_vars?: { pageId: string }) => Promise.resolve({})),
  deleteCommentSpy: vi.fn((_vars?: { id: string }) => Promise.resolve({})),
  archiveSpy: vi.fn((_vars?: { id: string }) => Promise.resolve({})),
  updateSpy: vi.fn((vars?: { id: string; isTemplate?: boolean }) => Promise.resolve({ ...vars })),
  createFromTemplateSpy: vi.fn((_vars?: { templateId: string; spaceId: string }) =>
    Promise.resolve({ id: "p2", title: "Kopie" }),
  ),
  restorePageSpy: vi.fn((_vars?: { id: string }) => Promise.resolve({})),
  deletePageSpy: vi.fn((_vars?: { id: string }) => Promise.resolve({ id: "p1", deleted: 1 })),
  navigateSpy: vi.fn(),
}));

// Passthrough the layout so the sidebar (and its many deps) stays out of scope.
vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Drive the client-side permission gate directly; its real impl reads better-auth.
vi.mock("@/lib/permissions", () => ({
  usePermission: () => ({ allowed: data.canEdit, isPending: false }),
}));

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
  // The route jumps to `#comment-<id>` when the inbox links at one.
  useLocation: () => ({ hash: "" }),
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
        key: () => ["page"],
      },
      archive: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: archiveSpy, ...opts }),
      },
      update: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: updateSpy, ...opts }),
      },
      listTemplates: { key: () => ["templates"] },
      createFromTemplate: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: createFromTemplateSpy,
          ...opts,
        }),
      },
      restore: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: restorePageSpy,
          ...opts,
        }),
      },
      delete: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: deletePageSpy,
          ...opts,
        }),
      },
      list: {
        key: () => ["pages"],
        // The breadcrumb resolves ancestors from the space's page list.
        queryOptions: ({ input }: { input: { spaceId: string } }) => ({
          queryKey: ["pages", input.spaceId],
          queryFn: async () => [],
        }),
      },
      listRevisions: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["revisions"],
          queryFn: async () => [],
          enabled,
        }),
        key: () => ["revisions"],
      },
      restoreRevision: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...opts }),
      },
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
    // The comment box offers space members for `@` mentions.
    spaceMembers: {
      list: {
        queryOptions: () => ({ queryKey: ["spaceMembers"], queryFn: async () => [] }),
      },
    },
    // The tag row and the aside's reference lists render alongside the page;
    // both stay empty here so they collapse and leave the assertions alone.
    tags: {
      listForPage: {
        queryOptions: () => ({ queryKey: ["pageTags"], queryFn: async () => [] }),
      },
      list: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["spaceTags"],
          queryFn: async () => [],
          enabled,
        }),
        key: () => ["spaceTags"],
      },
      attach: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
      detach: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
      create: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
    },
    attachments: {
      list: {
        queryOptions: () => ({ queryKey: ["attachments"], queryFn: async () => [] }),
        key: () => ["attachments"],
      },
      delete: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
    },
    links: {
      backlinks: {
        queryOptions: () => ({ queryKey: ["backlinks"], queryFn: async () => [] }),
      },
      outgoing: {
        queryOptions: () => ({ queryKey: ["outgoing"], queryFn: async () => [] }),
      },
    },
    externalLinks: {
      list: {
        queryOptions: () => ({ queryKey: ["external-links"], queryFn: async () => [] }),
      },
      create: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
      update: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
      move: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
      delete: { mutationOptions: (opts: Record<string, unknown>) => ({ ...opts }) },
    },
    pageAccess: {
      myRole: {
        queryOptions: () => ({
          queryKey: ["myRole"],
          queryFn: async () => ({ role: "editor", canWrite: data.canEdit, canManage: false }),
        }),
      },
    },
    legalHolds: {
      status: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["hold", data.hold],
          queryFn: async () => data.hold,
          enabled,
        }),
      },
      key: () => ["legalHolds"],
    },
    trash: {
      key: () => ["trash"],
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
    data.hold = { held: false, source: "none", reason: null, holdId: null };
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  // Published so its body renders — these fixtures exercise edit/archive/subscribe
  // affordances, not the draft-visibility gate (covered separately).
  const somePage = {
    id: "p1",
    spaceId: "s1",
    title: "Blank",
    slug: "blank",
    icon: null,
    status: "published",
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

    // The title renders as the page heading and in the breadcrumb trail.
    expect(await screen.findByRole("heading", { name: "Runbook" })).toBeDefined();
    expect(screen.getByText("Restart the pods.")).toBeDefined();
    // Status shows in both the header badge and the metadata rail.
    expect(screen.getAllByText("Veröffentlicht").length).toBeGreaterThan(0);
    // The space appears as a breadcrumb link back to its overview.
    expect(screen.getByText("Operations")).toBeDefined();
    // Only the unresolved comment counts (comments load after the page).
    expect(await screen.findByRole("heading", { name: "Kommentare (1)" })).toBeDefined();
    expect(screen.getByText("Works")).toBeDefined();
    expect(screen.queryByText("resolved one")).toBeNull();
  });

  it("shows a not-yet-published hint for an empty draft", async () => {
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

    expect(await screen.findByText("Diese Seite wurde noch nicht veröffentlicht.")).toBeDefined();
    expect(screen.getByText("Noch keine Kommentare.")).toBeDefined();
  });

  it("shows a generic empty hint for a published page with no content", async () => {
    data.page = {
      id: "p1",
      spaceId: "s1",
      title: "Blank",
      slug: "blank",
      icon: null,
      status: "published",
      textContent: "   ",
      updatedAt: new Date("2026-01-02T10:00:00Z"),
    };
    renderView();

    expect(await screen.findByText("Diese Seite hat noch keinen Inhalt.")).toBeDefined();
  });

  it("shows a not-found state when the page errors", async () => {
    data.error = true;
    renderView();
    expect(await screen.findByText("Seite nicht gefunden")).toBeDefined();
  });

  it("jumps to comments by scrolling the page container instead of the viewport", async () => {
    data.page = somePage;
    data.comments = [
      { id: "c1", body: "Q", resolvedAt: null, deletedAt: null, createdAt: new Date() },
      { id: "c2", body: "A", resolvedAt: null, deletedAt: null, createdAt: new Date() },
      { id: "c3", body: "Note", resolvedAt: null, deletedAt: null, createdAt: new Date() },
    ];

    const pageScroll = document.createElement("div");
    pageScroll.setAttribute("data-page-scroll", "");
    pageScroll.scrollTop = 700;
    pageScroll.scrollTo = vi.fn();
    vi.spyOn(pageScroll, "getBoundingClientRect").mockReturnValue({
      top: 20,
      left: 0,
      right: 1000,
      bottom: 820,
      width: 1000,
      height: 800,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    });
    document.body.append(pageScroll);

    renderView();
    const commentsSection = await screen.findByRole("heading", { name: "Kommentare (3)" });
    const section = commentsSection.closest("section") as HTMLElement;
    section.style.scrollMarginTop = "24px";
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({
      top: 1220,
      left: 0,
      right: 700,
      bottom: 1500,
      width: 700,
      height: 280,
      x: 0,
      y: 1220,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "3 Kommentare" }));

    expect(pageScroll.scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 1876 });
    expect(scrollIntoView).not.toHaveBeenCalled();
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
    // Deleting now requires confirming in an AlertDialog first.
    fireEvent.click(await screen.findByRole("button", { name: "Kommentar löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));
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
    // Archiving writes to the page, so the affordance follows write access — it
    // used to be offered to readers whose click the server then refused.
    data.canEdit = true;
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

  it("offers a restore instead of an archive for an archived page", async () => {
    data.page = { ...somePage, status: "archived", archivedAt: new Date("2026-01-03T10:00:00Z") };
    data.canEdit = true;
    renderView();

    // Archived and deleted are different states, and only the former is undone
    // from here — the trash lives in the space's own view.
    fireEvent.click(await screen.findByRole("button", { name: "Wiederherstellen" }));
    await waitFor(() => expect(restorePageSpy.mock.calls[0]?.[0]).toEqual({ id: "p1" }));
    expect(screen.queryByRole("button", { name: "Archivieren" })).toBeNull();
  });

  it("moves the page to the trash after confirming, and says it is recoverable", async () => {
    data.page = somePage;
    data.canEdit = true;
    data.spaces = [{ id: "s1", slug: "ops", name: "Operations", visibility: "public" }];
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    // The copy has to distinguish this from a permanent delete, or nobody can
    // tell the two buttons apart.
    expect(within(dialog).getByText(/Papierkorb des Bereichs wiederherstellen/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "In den Papierkorb" }));

    await waitFor(() => expect(deletePageSpy.mock.calls[0]?.[0]).toEqual({ id: "p1" }));
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/spaces/$slug", params: { slug: "ops" } }),
    );
  });

  it("marks a blocked page and disables its delete button", async () => {
    data.page = somePage;
    data.canEdit = true;
    data.hold = { held: true, source: "page", reason: "Rechtsstreit", holdId: "h1" };
    renderView();

    // Without the badge a blocked page reads as a broken button, so both the
    // marker and the disabled state are asserted together.
    expect(await screen.findByText("Löschsperre")).toBeDefined();
    expect(screen.getByRole("button", { name: "Löschen" })).toHaveProperty("disabled", true);
  });

  it("hides the edit affordance without update permission", async () => {
    data.page = somePage;
    data.canEdit = false;
    renderView();
    await screen.findByText("body");
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
  });

  it("marks a page as a template from the header", async () => {
    data.page = somePage;
    data.canEdit = true;
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Als Vorlage markieren" }));
    await waitFor(() =>
      expect(updateSpy.mock.calls[0]?.[0]).toEqual({ id: "p1", isTemplate: true }),
    );
  });

  it("explains a template and creates a page from it", async () => {
    data.page = { ...somePage, isTemplate: true };
    data.canEdit = true;
    renderView();

    expect(await screen.findByText(/Diese Seite ist eine Vorlage/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Vorlage verwenden" }));
    await waitFor(() =>
      expect(createFromTemplateSpy.mock.calls[0]?.[0]).toEqual({
        templateId: "p1",
        spaceId: "s1",
      }),
    );
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/pages/$id", params: { id: "p2" } }),
    );
  });

  it("opens and closes the editor when permitted", async () => {
    data.page = somePage;
    data.canEdit = true;
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect(await screen.findByText("EDITOR AKTIV")).toBeDefined();
    // Only the header + body swap: the surrounding view chrome (comment box,
    // right rail) stays put so the page does not re-flow around the editor.
    expect(screen.getByPlaceholderText("Kommentar schreiben …")).toBeDefined();
    expect(screen.getByRole("button", { name: "Versionsverlauf" })).toBeDefined();
    // The read body is gone — the editor owns that slot now.
    expect(screen.queryByText("body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Editor schließen" }));
    expect(await screen.findByText("body")).toBeDefined();
    expect(screen.queryByText("EDITOR AKTIV")).toBeNull();
  });
});
