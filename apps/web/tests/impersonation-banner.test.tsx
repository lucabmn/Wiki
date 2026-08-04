import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { session, stopImpersonating } = vi.hoisted(() => ({
  session: { current: null as unknown },
  stopImpersonating: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: session.current }),
    admin: { stopImpersonating },
  },
}));

import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ImpersonationBanner />, { wrapper });
}

beforeEach(() => {
  session.current = null;
  stopImpersonating.mockReset();
  stopImpersonating.mockResolvedValue({ data: {}, error: null });
});

describe("impersonation banner", () => {
  it("stays out of the way for an ordinary session", () => {
    session.current = {
      user: { id: "u1", name: "Pia" },
      session: { impersonatedBy: null, expiresAt: new Date() },
    };
    const { container } = renderBanner();
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names whose account is being used while impersonating", () => {
    session.current = {
      user: { id: "u2", name: "Pia Müller" },
      session: { impersonatedBy: "uAdmin", expiresAt: new Date(Date.now() + 25 * 60_000) },
    };
    renderBanner();

    // The point of the banner is that the admin can never forget *whose*
    // account they are writing in.
    expect(screen.getByText("Pia Müller")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("protokolliert");
  });

  it("shows how long the borrowed session still has", () => {
    session.current = {
      user: { id: "u2", name: "Pia" },
      session: { impersonatedBy: "uAdmin", expiresAt: new Date(Date.now() + 25.5 * 60_000) },
    };
    renderBanner();
    expect(screen.getByRole("status").textContent).toContain("25 Min.");
  });

  it("offers the way out in one click", async () => {
    session.current = {
      user: { id: "u2", name: "Pia" },
      session: { impersonatedBy: "uAdmin", expiresAt: new Date(Date.now() + 60_000) },
    };
    // jsdom refuses real navigation; the banner reloads on success.
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /Impersonation beenden/ }));
    await waitFor(() => expect(stopImpersonating).toHaveBeenCalledOnce());
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/admin/users"));
  });
});
