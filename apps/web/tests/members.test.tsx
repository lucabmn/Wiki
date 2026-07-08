import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { members } = vi.hoisted(() => ({ members: [] as unknown[] }));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useRouteContext: () => ({
      auth: { organization: { name: "Acme", members } },
    }),
    ...opts,
  }),
}));

import { Route } from "@/routes/_auth/members";

const Members = (Route as unknown as { component: () => ReactNode }).component;

describe("members route", () => {
  it("lists members with their roles", () => {
    members.length = 0;
    members.push(
      { id: "m1", role: "owner", user: { name: "Luca Braun", email: "luca@acme.io" } },
      { id: "m2", role: "member", user: { name: "Mia Kern", email: "mia@acme.io" } },
    );
    render(<Members />);

    expect(screen.getByText("2 Mitglieder in Acme.")).toBeDefined();
    expect(screen.getByText("Luca Braun")).toBeDefined();
    expect(screen.getByText("luca@acme.io")).toBeDefined();
    expect(screen.getByText("Inhaber")).toBeDefined();
    expect(screen.getByText("Mia Kern")).toBeDefined();
    expect(screen.getByText("Mitglied")).toBeDefined();
  });

  it("uses the singular for a lone member", () => {
    members.length = 0;
    members.push({ id: "m1", role: "admin", user: { name: "Solo Dev", email: "solo@acme.io" } });
    render(<Members />);

    expect(screen.getByText("1 Mitglied in Acme.")).toBeDefined();
    expect(screen.getByText("Administrator")).toBeDefined();
  });
});
