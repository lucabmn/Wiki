import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { attachments: [] as unknown[], remove: vi.fn() },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.attachments }),
  useMutation: () => ({ mutate: state.remove, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/utils/orpc", () => ({
  friendlyErrorMessage: (error: Error) => error.message,
  orpc: {
    attachments: {
      list: { queryOptions: () => ({ queryKey: ["attachments"] }), key: () => ["attachments"] },
      delete: { mutationOptions: () => ({}) },
    },
  },
}));

import { PageAttachments } from "@/components/pages/page-attachments";

const file = { id: "a1", fileName: "spec.pdf", size: 2048 };

const renderList = (canEdit = true) =>
  render(<PageAttachments pageId="p1" spaceId="s1" canEdit={canEdit} />);

afterEach(() => vi.unstubAllGlobals());

describe("PageAttachments", () => {
  it("renders nothing for a read-only viewer with no attachments", () => {
    state.attachments = [];
    const { container } = renderList(false);
    expect(container.textContent).toBe("");
  });

  it("lists an attachment with a human-readable size and a download link", () => {
    state.attachments = [file];
    renderList(false);
    expect(screen.getByText("spec.pdf")).toBeDefined();
    expect(screen.getByText("2.0 KB")).toBeDefined();
    const link = screen.getByLabelText("spec.pdf herunterladen") as HTMLAnchorElement;
    // Bytes are proxied by the API server, never fetched from the bucket.
    expect(link.getAttribute("href")).toBe("http://localhost:3000/attachments/a1/download");
  });

  it("hides upload and delete from read-only viewers", () => {
    state.attachments = [file];
    renderList(false);
    expect(screen.queryByText("Datei hinzufügen")).toBeNull();
    expect(screen.queryByLabelText("spec.pdf löschen")).toBeNull();
  });

  it("deletes an attachment on click", () => {
    state.attachments = [file];
    state.remove.mockClear();
    renderList();
    fireEvent.click(screen.getByLabelText("spec.pdf löschen"));
    expect(state.remove).toHaveBeenCalledWith({ id: "a1" });
  });

  it("posts the file with its space and page to the upload route", async () => {
    state.attachments = [];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    renderList();

    const input = screen.getByLabelText("Datei auswählen") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/attachments/upload");
    // The session is a cookie on a different origin, so it must be forwarded.
    expect(init.credentials).toBe("include");
    const body = init.body as FormData;
    expect(body.get("spaceId")).toBe("s1");
    expect(body.get("pageId")).toBe("p1");
    expect((body.get("file") as File).name).toBe("notes.txt");
  });
});
