import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, navigate, signInEmail } = vi.hoisted(() => ({
  state: {
    // What better-auth answers to signIn.email: either a session, or the
    // two-factor marker with no session at all.
    result: { data: {} as Record<string, unknown>, error: null as { status: number } | null },
  },
  navigate: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    signIn: {
      email: async (input: unknown) => {
        signInEmail(input);
        return state.result;
      },
    },
  },
}));

import SignInForm from "@/components/auth/sign-in-form";

const submit = () => {
  render(<SignInForm onSwitchToSignUp={() => {}} />);
  fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "luca@acme.io" } });
  fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "supersecret" } });
  fireEvent.submit(screen.getByRole("button", { name: "Anmelden" }).closest("form")!);
};

describe("sign-in with two-factor", () => {
  beforeEach(() => {
    navigate.mockClear();
    signInEmail.mockClear();
  });

  it("sends a caller with 2FA to the challenge route instead of the dashboard", async () => {
    state.result = { data: { twoFactorRedirect: true }, error: null };
    submit();

    // Landing on "/" here would bounce straight back to the login form: the
    // credentials alone created no session.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/auth/two-factor" }));
  });

  it("goes to the dashboard when no second factor is required", async () => {
    state.result = { data: { user: { id: "u1" } }, error: null };
    submit();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("navigates nowhere when the credentials are rejected", async () => {
    state.result = { data: {}, error: { status: 401 } };
    submit();

    await waitFor(() => expect(signInEmail).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});
