import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceIconPicker } from "@/components/spaces/space-icon-picker";
import { Dialog, DialogContent } from "@nilovon-wiki/ui/components/dialog";
import { Sheet, SheetContent } from "@nilovon-wiki/ui/components/sheet";

const onChange = vi.fn();

function renderPicker(value: string | null = null) {
  return render(
    <SpaceIconPicker value={value} onChange={onChange} name="Handbuch" color="#1E6DE1" />,
  );
}

const trigger = () => screen.getByRole("button", { name: "Icon auswählen" });

const openPopover = async () => {
  fireEvent.click(trigger());
  await waitFor(() => expect(screen.getByLabelText("Icon 📚")).toBeDefined());
};

describe("SpaceIconPicker", () => {
  beforeEach(() => onChange.mockClear());

  it("falls back to the space initial when no icon is set", () => {
    renderPicker(null);
    expect(trigger().textContent).toBe("H");
  });

  it("shows the current icon instead of the initial", () => {
    renderPicker("🚀");
    expect(trigger().textContent).toBe("🚀");
  });

  it("selects a preset emoji", async () => {
    renderPicker(null);
    await openPopover();
    fireEvent.click(screen.getByLabelText("Icon 📚"));
    expect(onChange).toHaveBeenCalledWith("📚");
  });

  it("accepts a custom emoji from the text field", async () => {
    renderPicker(null);
    await openPopover();
    fireEvent.change(screen.getByLabelText("Eigenes Emoji"), { target: { value: "🦊" } });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(onChange).toHaveBeenCalledWith("🦊");
  });

  // A blank custom value passes the API's `max(64)` check, so it has to become
  // null here — otherwise the row holds junk the render sites treat as "unset".
  it("normalizes a blank custom value to null", async () => {
    renderPicker("🚀");
    await openPopover();
    fireEvent.change(screen.getByLabelText("Eigenes Emoji"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clears the icon", () => {
    renderPicker("🚀");
    fireEvent.click(screen.getByRole("button", { name: /Icon entfernen/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("offers no clear action when there is nothing to clear", () => {
    renderPicker(null);
    expect(screen.queryByRole("button", { name: /Icon entfernen/ })).toBeNull();
  });

  // The picker's real homes are the settings sheet and the create dialog. Both
  // are modal base-ui surfaces, and the popover portals out of their subtree —
  // so focus trapping and outside-press handling get a say the standalone
  // render above never exercises.
  describe.each([
    [
      "sheet",
      (node: ReactNode) => (
        <Sheet open>
          <SheetContent>{node}</SheetContent>
        </Sheet>
      ),
    ],
    [
      "dialog",
      (node: ReactNode) => (
        <Dialog open>
          <DialogContent>{node}</DialogContent>
        </Dialog>
      ),
    ],
  ])("inside a %s", (_label, wrap) => {
    const renderNested = () =>
      render(
        wrap(<SpaceIconPicker value={null} onChange={onChange} name="Handbuch" color="#1E6DE1" />),
      );

    it("selects a preset emoji", async () => {
      renderNested();
      await openPopover();
      fireEvent.click(screen.getByLabelText("Icon 📚"));
      expect(onChange).toHaveBeenCalledWith("📚");
    });

    it("accepts a custom emoji from the text field", async () => {
      renderNested();
      await openPopover();
      fireEvent.change(screen.getByLabelText("Eigenes Emoji"), { target: { value: "🦊" } });
      fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
      expect(onChange).toHaveBeenCalledWith("🦊");
    });
  });
});
