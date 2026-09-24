import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type Lookup =
  | { kind: "ok"; invitation: { email: string; organizationName: string; role: string } }
  | { kind: "wrong-account" }
  | { kind: "invalid" };

const { state, accept, reject, navigate, queryOptions } = vi.hoisted(() => ({
  state: {
    session: null as { user: { email: string; id?: string } } | null,
    lookup: undefined as Lookup | undefined,
    getInvitation: { data: null as unknown, error: null as { status: number } | null },
  },
  accept: vi.fn(),
  reject: vi.fn(),
  navigate: vi.fn(),
  queryOptions: { current: null as null | { enabled: boolean; queryFn: () => Promise<unknown> } },
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
  useQuery: (options: { enabled: boolean; queryFn: () => Promise<unknown> }) => {
    queryOptions.current = options;
    return { data: options.enabled ? state.lookup : undefined, isPending: !options.enabled };
  },
  useQueryClient: () => ({ clear: vi.fn() }),
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
    signOut: vi.fn(),
    organization: {
      getInvitation: async () => state.getInvitation,
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
    state.session = { user: { email: "invitee@acme.io" } };
    state.lookup = { kind: "invalid" };
    render(<Accept />);
    expect(screen.getByText("Einladung ungültig")).toBeDefined();
  });

  it("sends a signed-out visitor to register first, without asking the server", () => {
    // better-auth answers `getInvitation` only for a signed-in recipient, so
    // signed out there is nothing to look up — and no dead-link verdict.
    state.session = null;
    state.lookup = undefined;
    render(<Accept />);
    expect(queryOptions.current?.enabled).toBe(false);
    expect(screen.queryByText("Einladung ungültig")).toBeNull();
    expect(screen.getByText("Konto erstellen")).toBeDefined();
    expect(screen.queryByText("Annehmen")).toBeNull();
  });

  it("refuses to accept while signed in as somebody else", () => {
    state.session = { user: { email: "someone.else@acme.io" } };
    state.lookup = { kind: "wrong-account" };
    render(<Accept />);
    expect(screen.getByText(/someone.else@acme.io/)).toBeDefined();
    expect(screen.getByText("Abmelden")).toBeDefined();
    expect(screen.queryByText("Annehmen")).toBeNull();
  });

  it("reads a 403 from better-auth as the wrong account, anything else as a dead link", async () => {
    state.session = { user: { email: "someone.else@acme.io" } };
    state.lookup = { kind: "invalid" };
    render(<Accept />);

    state.getInvitation = { data: null, error: { status: 403 } };
    await expect(queryOptions.current?.queryFn()).resolves.toEqual({ kind: "wrong-account" });
    state.getInvitation = { data: null, error: { status: 400 } };
    await expect(queryOptions.current?.queryFn()).resolves.toEqual({ kind: "invalid" });
    state.getInvitation = { data: invitation, error: null };
    await expect(queryOptions.current?.queryFn()).resolves.toEqual({ kind: "ok", invitation });
  });

  it("accepts only on an explicit click, never on mount", async () => {
    state.session = { user: { email: "invitee@acme.io" } };
    state.lookup = { kind: "ok", invitation };
    accept.mockClear();
    render(<Accept />);

    // The role is shown in German, not as better-auth's raw key.
    expect(screen.getByText("Du wurdest als Mitglied eingeladen.")).toBeDefined();

    // Mail clients and link scanners prefetch URLs; auto-accept would let a
    // scanner join the organization on the recipient's behalf.
    expect(accept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Annehmen"));
    await vi.waitFor(() => expect(accept).toHaveBeenCalled());
  });

  it("can reject the invitation", async () => {
    state.session = { user: { email: "invitee@acme.io" } };
    state.lookup = { kind: "ok", invitation };
    reject.mockClear();
    render(<Accept />);
    fireEvent.click(screen.getByText("Ablehnen"));
    await vi.waitFor(() => expect(reject).toHaveBeenCalled());
  });
});
