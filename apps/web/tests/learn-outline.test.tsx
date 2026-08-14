import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
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
}));

import { CourseOutlineList } from "@/components/learn/course-outline-list";

const lesson = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  title: "Erste Lektion",
  slug: "erste-lektion",
  kind: "dynamic",
  durationSeconds: 600,
  isRequired: true,
  published: true,
  status: "not_started" as const,
  locked: false,
  lockReason: "none",
  availableAt: null,
  ...over,
});

const chapter = (lessons: ReturnType<typeof lesson>[]) => ({
  id: "c1",
  title: "Grundlagen",
  description: null,
  published: true,
  locked: false,
  availableAt: null,
  lessons,
});

function renderOutline(lessons: ReturnType<typeof lesson>[]) {
  return render(<CourseOutlineList slug="kurs" chapters={[chapter(lessons)]} />);
}

describe("course outline", () => {
  it("links to a lesson the learner may open", () => {
    renderOutline([lesson()]);
    const link = screen.getByRole("link", { name: /Erste Lektion/ });
    expect(link.getAttribute("href")).toBe("/learn/courses/$slug/lessons/$lessonId");
  });

  it("does not link a locked lesson", () => {
    renderOutline([lesson({ locked: true, lockReason: "sequential" })]);
    expect(screen.queryByRole("link", { name: /Erste Lektion/ })).toBeNull();
  });

  it("says why a lesson is locked, per reason", () => {
    // A greyed-out row with no explanation is the most common way a
    // drip-released or sequential course reads as broken.
    renderOutline([
      lesson({ id: "a", title: "Gesperrt: Reihenfolge", locked: true, lockReason: "sequential" }),
      lesson({ id: "b", title: "Gesperrt: Termin", locked: true, lockReason: "drip" }),
      lesson({ id: "c", title: "Gesperrt: Zugang", locked: true, lockReason: "not_enrolled" }),
    ]);

    expect(screen.getByText(/Schließe zuerst die vorherige Lektion ab/)).toBeDefined();
    expect(screen.getByText(/Wird später freigeschaltet/)).toBeDefined();
    expect(screen.getByText(/Schreibe dich ein/)).toBeDefined();
  });

  it("marks progress so the sidebar reads at a glance", () => {
    renderOutline([
      lesson({ id: "a", title: "Fertig", status: "completed" }),
      lesson({ id: "b", title: "Angefangen", status: "in_progress" }),
      lesson({ id: "c", title: "Offen" }),
    ]);

    expect(screen.getByLabelText("Abgeschlossen")).toBeDefined();
    expect(screen.getByLabelText("Begonnen")).toBeDefined();
    expect(screen.getByLabelText("Offen")).toBeDefined();
  });

  it("shows staff that a lesson is still a draft", () => {
    renderOutline([lesson({ published: false })]);
    expect(screen.getByText("Entwurf")).toBeDefined();
  });

  it("marks optional lessons, because they do not count towards completion", () => {
    renderOutline([lesson({ isRequired: false })]);
    expect(screen.getByText("Optional")).toBeDefined();
  });
});
