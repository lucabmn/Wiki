import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { templates, createSpy, createFromTemplateSpy, navigateSpy } = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  createSpy: vi.fn((_vars?: { spaceId: string; title: string }) =>
    Promise.resolve({ id: "new-blank" }),
  ),
  createFromTemplateSpy: vi.fn((_vars?: { templateId: string; spaceId: string; title?: string }) =>
    Promise.resolve({ id: "new-from-template" }),
  ),
  navigateSpy: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigateSpy,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      create: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: createSpy, ...opts }),
      },
      createFromTemplate: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationFn: createFromTemplateSpy,
          ...opts,
        }),
      },
      listTemplates: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["templates"],
          queryFn: async () => templates,
          enabled,
        }),
      },
      list: { key: () => ["pages"] },
    },
    spaces: { list: { queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => [] }) } },
  },
}));

import { CreatePageDialog } from "@/components/create-page-dialog";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreatePageDialog open spaceId="s1" onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("create page dialog", () => {
  beforeEach(() => {
    templates.length = 0;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("offers the blank page even without templates and creates a plain draft", async () => {
    renderDialog();

    expect(await screen.findByText(/noch keine Vorlagen/)).toBeDefined();
    expect(screen.getByRole("radio", { name: /Leere Seite/ })).toHaveProperty(
      "ariaChecked",
      "true",
    );

    fireEvent.change(screen.getByLabelText("Seitentitel"), { target: { value: "Notizen" } });
    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));

    await waitFor(() =>
      expect(createSpy.mock.calls[0]?.[0]).toEqual({ spaceId: "s1", title: "Notizen" }),
    );
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: "/pages/$id",
        params: { id: "new-blank" },
      }),
    );
  });

  it("creates from the picked template and warns about an unpublished one", async () => {
    templates.push(
      {
        id: "t1",
        spaceId: "s1",
        title: "Meeting-Notiz",
        icon: "📝",
        excerpt: "Agenda, Notizen, Aufgaben",
        hasContent: true,
        status: "published",
        updatedAt: new Date(),
      },
      {
        id: "t2",
        spaceId: "s1",
        title: "Runbook",
        icon: null,
        excerpt: "",
        hasContent: false,
        status: "draft",
        updatedAt: new Date(),
      },
    );
    renderDialog();

    // The unpublished template says so before it is picked, not after.
    expect(await screen.findByText(/Noch nicht veröffentlicht/)).toBeDefined();

    fireEvent.click(screen.getByRole("radio", { name: /Meeting-Notiz/ }));
    fireEvent.change(screen.getByLabelText("Seitentitel"), { target: { value: "Retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));

    await waitFor(() =>
      expect(createFromTemplateSpy.mock.calls[0]?.[0]).toEqual({
        templateId: "t1",
        spaceId: "s1",
        title: "Retro",
      }),
    );
    expect(createSpy).not.toHaveBeenCalled();
  });
});
