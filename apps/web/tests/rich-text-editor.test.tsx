import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The link picker pulls in the orpc client; stub it (search isn't exercised here).
vi.mock("@/utils/orpc", () => ({
  orpc: {
    search: {
      pages: {
        queryOptions: () => ({ queryKey: ["search"], queryFn: async () => [] }),
      },
    },
  },
}));

import { RichTextEditor } from "@/components/editor/rich-text-editor";

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RichTextEditor
        spaceId="s1"
        initialContent={{
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
        }}
        onChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("RichTextEditor (real TipTap mount)", () => {
  it("mounts, renders the toolbar and the initial content", async () => {
    renderEditor();
    // Toolbar controls come from the real component, so a mount/config failure
    // (bad StarterKit option, SSR crash) surfaces here.
    expect(await screen.findByRole("button", { name: "Fett" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Seite verknüpfen" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Hochgestellt" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tiefgestellt" })).toBeDefined();
    // Grouped controls surface as dropdown/popover triggers.
    expect(screen.getByRole("button", { name: "Listen" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ausrichtung" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tabelle" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Farbe" })).toBeDefined();
    await waitFor(() => expect(screen.getByText("hello")).toBeDefined());
  });
});
