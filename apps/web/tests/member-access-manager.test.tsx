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

function renderManager(members: AccessMember[] = [alice]) {
  return render(
    <MemberAccessManager
      members={members}
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
    // The add form stays collapsed until asked for.
    fireEvent.click(screen.getByRole("button", { name: "Zugriff geben" }));
    // Selects, in order: [person/group picker, add-role, member row role].
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ subject: "user", value: "u2", role: "viewer" }),
    );
    // The form closes on success, and reopens with the picker reset.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Hinzufügen" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Zugriff geben" }));
    const picker = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(picker.value).toBe("");
  });

  it("changes a member's role via its row select", () => {
    renderManager();
    // Only the member row's role select is rendered while the add form is closed.
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "editor" } });
    expect(onUpdateRole).toHaveBeenCalledWith("m1", "editor");
  });

  it("groups long lists and filters them by name, email or group", () => {
    const people: AccessMember[] = Array.from({ length: 9 }, (_, i) => ({
      id: `u${i}`,
      subject: "user",
      role: "viewer",
      roleName: null,
      user: { id: `u${i}`, name: `Person ${i}`, email: `person${i}@acme.io` },
      team: null,
    }));
    const group: AccessMember = {
      id: "g1",
      subject: "role",
      role: "editor",
      roleName: "Redaktion",
      user: null,
      team: null,
    };
    renderManager([...people, group]);

    // Both kinds present → section headers with their counts.
    expect(screen.getByText("Gruppen · 1")).toBeDefined();
    expect(screen.getByText("Personen · 9")).toBeDefined();

    const filter = screen.getByRole("textbox", { name: "Mitglieder und Gruppen filtern" });
    fireEvent.change(filter, { target: { value: "person3@" } });
    expect(screen.getByText("Person 3")).toBeDefined();
    expect(screen.queryByText("Person 4")).toBeNull();
    expect(screen.queryByText("Redaktion")).toBeNull();
    expect(screen.getByText("1 von 10 Einträgen")).toBeDefined();

    fireEvent.change(filter, { target: { value: "redak" } });
    expect(screen.getByText("Redaktion")).toBeDefined();
    expect(screen.queryByText("Person 3")).toBeNull();

    fireEvent.change(filter, { target: { value: "niemand" } });
    expect(screen.getByText('Kein Treffer für „niemand".')).toBeDefined();
  });

  it("shows no filter for a short list", () => {
    renderManager();
    expect(screen.queryByRole("textbox", { name: "Mitglieder und Gruppen filtern" })).toBeNull();
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
