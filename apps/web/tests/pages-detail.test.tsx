import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data, createCommentSpy } = vi.hoisted(() => ({
  data: {
    page: undefined as unknown,
    comments: [] as unknown[],
    spaces: [] as unknown[],
    error: false,
  },
  createCommentSpy: vi.fn((_vars?: { pageId: string; body: string }) => Promise.resolve({})),
}));

// Passthrough the layout so the sidebar (and its many deps) stays out of scope.
vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ id: "p1" }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
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
    },
    spaces: {
      list: {
        queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }),
      },
    },
  },
}));

import { Route } from "@/routes/_auth/pages.$id";

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
    data.error = false;
  });

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
    expect(screen.getByText("Veröffentlicht")).toBeDefined();
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
});
