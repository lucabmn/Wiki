import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mount smoke tests for the three big learning routes.
 *
 * They assert almost nothing about the markup on purpose. What they buy is that
 * the component trees underneath — the builder, the player, the management
 * tabs, several thousand lines of it — actually execute: a typecheck and a
 * bundle prove imports resolve, not that a component renders. Each route is
 * exercised in both branches that decide what a caller sees at all: the
 * capability refusal, and the loaded page.
 */

const { data } = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useParams: () => ({ slug: "kurs", lessonId: "l1" }),
    ...opts,
  }),
  Link: ({
    children,
    to,
    params: _params,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

// A structural stand-in for the oRPC client: any `orpc.a.b.c` path resolves to
// query/mutation options whose result is looked up in `data` by dotted path.
// Enumerating the ~40 procedures these trees touch would make the test about
// the mock rather than about the routes.
vi.mock("@/utils/orpc", () => {
  const resultFor = (path: string[]) => data[path.join(".")] ?? null;

  const leaf = (path: string[]): Record<string, unknown> => ({
    queryOptions: ({ input, enabled }: { input?: unknown; enabled?: boolean } = {}) => ({
      queryKey: [path.join("."), input],
      queryFn: async () => resultFor(path),
      enabled,
    }),
    mutationOptions: (options: Record<string, unknown> = {}) => ({
      mutationFn: async () => resultFor(path),
      ...options,
    }),
    key: (): unknown[] => [path.join(".")],
  });

  const node = (path: string[]): unknown =>
    new Proxy(leaf(path), {
      get(target, property) {
        if (typeof property !== "string") return undefined;
        if (property in target) return Reflect.get(target, property);
        return node([...path, property]);
      },
    });

  const callable = (path: string[]): unknown =>
    new Proxy(async () => resultFor(path), {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        return callable([...path, property]);
      },
    });

  return { orpc: node([]), client: callable([]) };
});

import { Route as EditRoute } from "@/routes/_auth/learn/courses/$slug/edit";
import { Route as LessonRoute } from "@/routes/_auth/learn/courses/$slug/lessons/$lessonId";
import { Route as ManageRoute } from "@/routes/_auth/learn/courses/$slug/manage";

const componentOf = (route: unknown) => (route as { component: () => ReactNode }).component;

function renderRoute(route: unknown) {
  const Component = componentOf(route);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

const access = (over: Record<string, unknown> = {}) => ({
  canView: true,
  canLearn: true,
  role: "owner",
  canAuthor: true,
  canGrade: true,
  canManage: true,
  ...over,
});

const course = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  organizationId: "o1",
  slug: "kurs",
  title: "Onboarding",
  tagline: null,
  description: null,
  thumbnailAssetId: null,
  thumbnailUrl: null,
  status: "published",
  visibility: "organization",
  enrollmentPolicy: "open",
  level: null,
  language: null,
  estimatedMinutes: null,
  sequential: false,
  completionThreshold: 100,
  certificateEnabled: false,
  enrollmentClosesAt: null,
  maxSeats: null,
  createdBy: "u1",
  publishedAt: new Date(),
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lessonCount: 1,
  enrollmentCount: 1,
  averageRating: null,
  reviewCount: 0,
  topics: [],
  enrollment: { id: "e1", status: "active", progressPercent: 0, lastLessonId: null },
  access: access(),
  authors: [],
  price: null,
  enrollability: { allowed: false, reason: "already_enrolled" },
  seatsLeft: null,
  ...over,
});

const outline = {
  courseId: "c1",
  isStaff: true,
  totalLessons: 1,
  requiredLessons: 1,
  completedLessons: 0,
  progressPercent: 0,
  nextLessonId: "l1",
  chapters: [
    {
      id: "ch1",
      title: "Grundlagen",
      description: null,
      position: "a0",
      published: true,
      locked: false,
      availableAt: null,
      lessons: [
        {
          id: "l1",
          title: "Erste Lektion",
          slug: "erste-lektion",
          kind: "dynamic",
          position: "a0",
          durationSeconds: null,
          isRequired: true,
          published: true,
          status: "not_started",
          furthestPercent: 0,
          positionSeconds: 0,
          locked: false,
          lockReason: "none",
          availableAt: null,
        },
      ],
    },
  ],
};

const lesson = {
  id: "l1",
  courseId: "c1",
  chapterId: "ch1",
  kind: "dynamic",
  title: "Erste Lektion",
  slug: "erste-lektion",
  position: "a0",
  content: null,
  assetId: null,
  assetUrl: null,
  embedUrl: null,
  durationSeconds: null,
  isRequired: true,
  autoCompleteAtPercent: null,
  publishedAt: new Date(),
  createdBy: "u1",
  lastEditedBy: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  for (const key of Object.keys(data)) delete data[key];
  data["learn.courses.getBySlug"] = course();
  data["learn.lessons.outline"] = outline;
  data["learn.lessons.get"] = lesson;
  data["learn.chapters.list"] = outline.chapters;
  data["learn.courseTopics.list"] = [];
  data["learn.assets.capabilities"] = { enabled: true, maxUploadBytes: 10_000_000 };
  data["learn.enrollments.roster"] = [];
  data["learn.courseMembers.list"] = [];
  data["learn.courseUpdates.list"] = [];
  data["learn.analytics.courseOverview"] = {
    enrollmentCount: 0,
    activeCount: 0,
    completedCount: 0,
    droppedCount: 0,
    averageProgressPercent: 0,
    completionRate: 0,
    averageRating: null,
    submissionsAwaitingGrading: 0,
  };
  data["learn.analytics.lessonFunnel"] = [];
  data["learn.analytics.learnerProgress"] = [];
});

describe("course builder route", () => {
  it("refuses somebody without the authoring grant", async () => {
    data["learn.courses.getBySlug"] = course({ access: access({ canAuthor: false }) });
    renderRoute(EditRoute);
    expect(await screen.findByText(/mindestens Dozent/)).toBeDefined();
  });

  it("mounts the builder for an author", async () => {
    renderRoute(EditRoute);
    expect(await screen.findByText("Onboarding")).toBeDefined();
  });
});

describe("management route", () => {
  it("refuses somebody with none of the staff capabilities", async () => {
    data["learn.courses.getBySlug"] = course({
      access: access({ canAuthor: false, canGrade: false, canManage: false, role: null }),
    });
    renderRoute(ManageRoute);
    expect(await screen.findByText(/dem Kursteam vorbehalten/)).toBeDefined();
  });

  it("mounts the tabs for the course team", async () => {
    renderRoute(ManageRoute);
    expect(await screen.findByRole("tab", { name: "Teilnehmende" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Bewertung" })).toBeDefined();
  });
});

describe("lesson player route", () => {
  it("mounts the outline beside the lesson", async () => {
    renderRoute(LessonRoute);
    expect(await screen.findByRole("navigation", { name: "Kursinhalt" })).toBeDefined();
    expect(await screen.findByText("Erste Lektion")).toBeDefined();
  });
});
