import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: { courses: [] as unknown[], topics: [] as unknown[], canCreate: true },
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/learn/create-course-dialog", () => ({ CreateCourseDialog: () => null }));
vi.mock("@/lib/permissions", () => ({ usePermission: () => data.canCreate }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ slug: "typescript" }),
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    learn: {
      courses: {
        list: {
          queryOptions: () => ({ queryKey: ["courses"], queryFn: async () => data.courses }),
          key: () => ["courses"],
        },
      },
      courseTopics: {
        list: {
          queryOptions: () => ({ queryKey: ["topics"], queryFn: async () => data.topics }),
          key: () => ["topics"],
        },
      },
    },
  },
}));

import { Route } from "@/routes/_auth/learn/index";

const Catalog = (Route as unknown as { component: () => ReactNode }).component;

function renderCatalog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Catalog />
    </QueryClientProvider>,
  );
}

const course = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  slug: "typescript",
  title: "TypeScript für Teams",
  tagline: "Typen, die tragen.",
  thumbnailUrl: null,
  status: "published",
  level: "beginner",
  estimatedMinutes: 90,
  lessonCount: 12,
  enrollmentCount: 34,
  averageRating: 4.5,
  reviewCount: 8,
  topics: [],
  enrollment: null,
  ...over,
});

beforeEach(() => {
  data.courses = [];
  data.topics = [];
  data.canCreate = true;
});

describe("learn catalog", () => {
  it("renders a course card with its counts", async () => {
    data.courses = [course()];
    renderCatalog();

    expect(await screen.findByText("TypeScript für Teams")).toBeDefined();
    expect(screen.getByText("Typen, die tragen.")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("34")).toBeDefined();
  });

  it("shows a progress bar only for courses the caller is taking", async () => {
    data.courses = [
      course({ id: "c1", slug: "a", title: "Ohne Fortschritt" }),
      course({
        id: "c2",
        slug: "b",
        title: "Mit Fortschritt",
        enrollment: { status: "active", progressPercent: 40 },
      }),
    ];
    renderCatalog();

    await screen.findByText("Mit Fortschritt");
    // A 0 % bar on every catalog card would be noise, so exactly one appears.
    expect(screen.getAllByText("40 % abgeschlossen")).toHaveLength(1);
    expect(screen.queryByText("0 % abgeschlossen")).toBeNull();
  });

  it("marks a completed course as such instead of showing 100 %", async () => {
    data.courses = [course({ enrollment: { status: "completed", progressPercent: 100 } })];
    renderCatalog();

    expect(await screen.findAllByText("Abgeschlossen")).not.toHaveLength(0);
  });

  it("explains an empty catalog rather than showing a blank grid", async () => {
    renderCatalog();
    expect(await screen.findByText("Noch keine Kurse")).toBeDefined();
  });

  it("hides the create action from someone without the permission", async () => {
    data.canCreate = false;
    renderCatalog();
    expect(screen.queryByRole("button", { name: /Kurs erstellen/ })).toBeNull();
  });

  it("labels drafts so an author can tell them apart in the grid", async () => {
    data.courses = [course({ status: "draft" })];
    renderCatalog();
    expect(await screen.findByText("Entwurf")).toBeDefined();
  });
});
