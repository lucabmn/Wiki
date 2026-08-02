import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { state, accept, reject, navigate } = vi.hoisted(() => ({
  state: {
    session: null as { user: { email: string } } | null,
    invitation: null as { email: string; organizationName: string; role: string } | null,
  },
  accept: vi.fn(),
  reject: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ id: "inv_1" }),
    ...opts,
  }),
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.invitation, isPending: false }),
  // Both mutations are distinguished by the spy their mutationFn closes over,
  // so hand each hook its own recorded call target.
  useMutation: ({ mutationFn }: { mutationFn: () => unknown }) => ({
    mutate: mutationFn,
    isPending: false,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: state.session, isPending: false }),
    organization: {
      getInvitation: async () => ({ data: state.invitation, error: null }),
      acceptInvitation: async () => {
        accept();
        return { error: null };
      },
      rejectInvitation: async () => {
        reject();
        return { error: null };
      },
    },
  },
}));

vi.mock("@/components/loader", () => ({ default: () => <div>loading</div> }));

import { Route } from "@/routes/accept-invitation.$id";

const Accept = (Route as unknown as { component: () => ReactNode }).component;

const invitation = { email: "invitee@acme.io", organizationName: "Acme", role: "member" };

describe("accept-invitation route", () => {
  it("explains the dead link when no open invitation matches", () => {
    state.invitation = null;
    state.session = null;
    render(<Accept />);
    expect(screen.getByText("Einladung ungültig")).toBeDefined();
  });

  it("sends a signed-out visitor to register first", () => {
    state.invitation = invitation;
    state.session = null;
    render(<Accept />);
    expect(screen.getByText("Einladung zu Acme")).toBeDefined();
    expect(screen.getByText("Konto erstellen")).toBeDefined();
    // Acceptance is bound to the session's email, so there is nothing to accept yet.
    expect(screen.queryByText("Annehmen")).toBeNull();
  });

  it("refuses to accept while signed in as somebody else", () => {
    state.invitation = invitation;
    state.session = { user: { email: "someone.else@acme.io" } };
    render(<Accept />);
    expect(screen.getByText(/someone.else@acme.io/)).toBeDefined();
    expect(screen.queryByText("Annehmen")).toBeNull();
  });

  it("accepts only on an explicit click, never on mount", async () => {
    state.invitation = invitation;
    state.session = { user: { email: "invitee@acme.io" } };
    accept.mockClear();
    render(<Accept />);

    // Mail clients and link scanners prefetch URLs; auto-accept would let a
    // scanner join the organization on the recipient's behalf.
    expect(accept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Annehmen"));
    await vi.waitFor(() => expect(accept).toHaveBeenCalled());
  });

  it("can reject the invitation", async () => {
    state.invitation = invitation;
    state.session = { user: { email: "invitee@acme.io" } };
    reject.mockClear();
    render(<Accept />);
    fireEvent.click(screen.getByText("Ablehnen"));
    await vi.waitFor(() => expect(reject).toHaveBeenCalled());
  });
});
