import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { templates, updateSpy } = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  updateSpy: vi.fn((_vars?: { id: string; isTemplate: boolean }) =>
    Promise.resolve({ id: "t1", title: "Meeting-Notiz" }),
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      listTemplates: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["templates"],
          queryFn: async () => templates,
          enabled,
        }),
        key: () => ["templates"],
      },
      update: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationFn: updateSpy, ...opts }),
      },
      list: { key: () => ["pages"] },
    },
  },
}));

import { SpaceTemplates } from "@/components/spaces/space-templates";

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SpaceTemplates spaceId="s1" enabled onNavigate={() => {}} />
    </QueryClientProvider>,
  );
}

describe("space template management", () => {
  beforeEach(() => {
    templates.length = 0;
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("explains how to create the first template when there is none", async () => {
    renderSection();
    expect(await screen.findByText(/markiere sie in der Kopfzeile als Vorlage/)).toBeDefined();
  });

  it("releases a template back into the page tree", async () => {
    templates.push({
      id: "t1",
      spaceId: "s1",
      title: "Meeting-Notiz",
      icon: "📝",
      excerpt: "Agenda, Notizen, Aufgaben",
      hasContent: true,
      status: "published",
      updatedAt: new Date(),
    });
    renderSection();

    expect(await screen.findByText("Meeting-Notiz")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Freigeben" }));

    await waitFor(() =>
      expect(updateSpy.mock.calls[0]?.[0]).toEqual({ id: "t1", isTemplate: false }),
    );
  });
});
