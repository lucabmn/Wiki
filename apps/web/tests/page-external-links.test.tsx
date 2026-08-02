import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    links: [] as unknown[],
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
  },
}));

// One mutation stub per procedure: `mutationOptions` is called on the procedure
// the component chose, so the returned handle identifies which one it wants.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.links }),
  useMutation: (options: { __kind: keyof typeof state }) => ({
    mutate: state[options.__kind] as ReturnType<typeof vi.fn>,
    isPending: false,
  }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

vi.mock("@/utils/orpc", () => ({
  friendlyErrorMessage: (error: Error) => error.message,
  orpc: {
    externalLinks: {
      list: { queryOptions: () => ({ queryKey: ["external-links"] }) },
      create: { mutationOptions: () => ({ __kind: "create" }) },
      update: { mutationOptions: () => ({ __kind: "update" }) },
      move: { mutationOptions: () => ({ __kind: "move" }) },
      delete: { mutationOptions: () => ({ __kind: "remove" }) },
    },
  },
}));

import { PageExternalLinks } from "@/components/pages/page-external-links";

const spec = {
  id: "l1",
  pageId: "p1",
  url: "https://www.example.com/spec",
  title: "Spezifikation",
  description: "Der maßgebliche Text",
  position: 0,
};
const ticket = { ...spec, id: "l2", url: "https://tickets.example.com/42", title: "Ticket 42" };

const renderList = (canEdit = true) => render(<PageExternalLinks pageId="p1" canEdit={canEdit} />);

beforeEach(() => {
  state.links = [];
  for (const key of ["create", "update", "move", "remove"] as const) state[key].mockClear();
});

describe("PageExternalLinks", () => {
  it("renders nothing for a read-only viewer with no links", () => {
    const { container } = renderList(false);
    expect(container.textContent).toBe("");
  });

  it("shows the title, the host without www, and the description", () => {
    state.links = [spec];
    renderList(false);
    const link = screen.getByRole("link", { name: "Spezifikation" });
    expect(link.getAttribute("href")).toBe("https://www.example.com/spec");
    expect(screen.getByText("example.com")).toBeDefined();
    expect(screen.getByText("Der maßgebliche Text")).toBeDefined();
  });

  it("opens links in a new tab without leaking the referrer or an opener handle", () => {
    state.links = [spec];
    renderList(false);
    const link = screen.getByRole("link", { name: "Spezifikation" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("hides every editing affordance from read-only viewers", () => {
    state.links = [spec];
    renderList(false);
    expect(screen.queryByText("Link hinzufügen")).toBeNull();
    expect(screen.queryByLabelText("Spezifikation entfernen")).toBeNull();
    expect(screen.queryByLabelText("Spezifikation bearbeiten")).toBeNull();
  });

  it("removes a link on click", () => {
    state.links = [spec];
    renderList();
    fireEvent.click(screen.getByLabelText("Spezifikation entfernen"));
    expect(state.remove).toHaveBeenCalledWith({ id: "l1" });
  });

  it("moves a link and disables the arrows at the ends of the list", () => {
    state.links = [spec, ticket];
    renderList();
    // First row can only go down, last row only up.
    expect((screen.getByLabelText("Spezifikation nach oben") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("Ticket 42 nach unten") as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByLabelText("Spezifikation nach unten"));
    expect(state.move).toHaveBeenCalledWith({ id: "l1", direction: "down" });
  });

  it("normalizes a hand-typed URL and falls back to the host as the title", () => {
    renderList();
    fireEvent.click(screen.getByText("Link hinzufügen"));
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "example.com/docs" } });
    fireEvent.click(screen.getByText("Hinzufügen"));
    expect(state.create).toHaveBeenCalledWith({
      pageId: "p1",
      url: "https://example.com/docs",
      title: "example.com",
      description: null,
    });
  });

  it("refuses to submit a non-http URL", () => {
    renderList();
    fireEvent.click(screen.getByText("Link hinzufügen"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(
      screen.getByText("Nur vollständige http- oder https-Adressen sind erlaubt."),
    ).toBeDefined();
    expect((screen.getByText("Hinzufügen").closest("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it("pre-fills the dialog when editing an existing link", () => {
    state.links = [spec];
    renderList();
    fireEvent.click(screen.getByLabelText("Spezifikation bearbeiten"));
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe(
      "https://www.example.com/spec",
    );
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Spec v2" } });
    fireEvent.click(screen.getByText("Speichern"));
    expect(state.update).toHaveBeenCalledWith({
      id: "l1",
      url: "https://www.example.com/spec",
      title: "Spec v2",
      description: "Der maßgebliche Text",
    });
  });
});
