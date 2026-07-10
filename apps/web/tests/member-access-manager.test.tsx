import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemberAccessManager, type AccessMember } from "@/components/access/member-access-manager";

const alice: AccessMember = {
  id: "m1",
  subject: "user",
  role: "viewer",
  roleName: null,
  user: { id: "u1", name: "Alice", email: "alice@acme.io" },
  team: null,
};

const onAdd = vi.fn(() => Promise.resolve({}));
const onUpdateRole = vi.fn();
const onRemove = vi.fn(() => Promise.resolve({}));

function renderManager() {
  return render(
    <MemberAccessManager
      members={[alice]}
      isLoading={false}
      addableUsers={[{ user: { id: "u2", name: "Bob" } }]}
      addableGroups={[]}
      defaultRole="viewer"
      onAdd={onAdd}
      addPending={false}
      onUpdateRole={onUpdateRole}
      updatePending={false}
      onRemove={onRemove}
      removePending={false}
      noUsersHint="no users"
      noGroupsHint="no groups"
      removeDescription={(label) => `${label} loses access.`}
    />,
  );
}

describe("MemberAccessManager", () => {
  beforeEach(() => {
    onAdd.mockClear();
    onUpdateRole.mockClear();
    onRemove.mockClear();
  });

  it("adds the selected person with the chosen role, then clears the picker", async () => {
    renderManager();
    // Selects, in order: [person/group picker, add-role, member row role].
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ subject: "user", value: "u2", role: "viewer" }),
    );
    // Picker resets to the placeholder after a successful add.
    await waitFor(() => expect((selects[0] as HTMLSelectElement).value).toBe(""));
  });

  it("changes a member's role via its row select", () => {
    renderManager();
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[2]!, { target: { value: "editor" } });
    expect(onUpdateRole).toHaveBeenCalledWith("m1", "editor");
  });

  it("removes a member only after confirming in the dialog", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "Entfernen" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Alice loses access.")).toBeDefined();
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("m1"));
  });
});
