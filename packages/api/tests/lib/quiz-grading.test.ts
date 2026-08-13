import { describe, expect, it } from "vitest";

import {
  gradeQuiz,
  type GradableQuestion,
  type QuizQuestionKind,
  type QuizResponseInput,
} from "../../src/lib/quiz-grading";

/**
 * The quiz grading truth table.
 *
 * This is the code that decides whether someone passed a course, so the four
 * question kinds are enumerated against correct, wrong, partial and missing
 * answers rather than sampled — and the arithmetic edges (empty quiz, threshold
 * boundary) are pinned separately, because those are the ones that fail as a
 * 500 rather than as a wrong grade.
 */

const BASE: GradableQuestion = {
  id: "q1",
  kind: "single_choice",
  points: 1,
  correctOptionIds: ["a"],
  acceptedAnswers: [],
};

const question = (over: Partial<GradableQuestion> = {}): GradableQuestion => ({
  ...BASE,
  ...over,
});

/** Grades a one-question quiz and returns just that question's result. */
function gradeOne(q: GradableQuestion, response?: QuizResponseInput) {
  const graded = gradeQuiz({
    questions: [q],
    responses: response ? [response] : [],
    passingPercent: 70,
  });
  return graded.results[0]!;
}

describe("gradeQuiz — single choice", () => {
  const q = question({ kind: "single_choice", points: 3, correctOptionIds: ["a"] });

  it("awards the points for the correct option", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["a"] })).toEqual({
      questionId: "q1",
      isCorrect: true,
      pointsAwarded: 3,
    });
  });

  it("awards nothing for the wrong option", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["b"] })).toEqual({
      questionId: "q1",
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it("rejects more than one selection", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["a", "b"] }).isCorrect).toBe(false);
  });

  it("treats a repeated id as a single selection", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["a", "a"] }).isCorrect).toBe(true);
  });

  it("rejects an empty selection", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: [] }).isCorrect).toBe(false);
  });
});

describe("gradeQuiz — true/false", () => {
  it("grades exactly like a single choice question", () => {
    const q = question({ kind: "true_false", correctOptionIds: ["true"] });
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["true"] }).isCorrect).toBe(true);
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["false"] }).isCorrect).toBe(false);
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: [] }).isCorrect).toBe(false);
  });
});

describe("gradeQuiz — multiple choice", () => {
  const q = question({ kind: "multiple_choice", points: 4, correctOptionIds: ["a", "b"] });

  it("awards the points only for the exact set", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["b", "a"] })).toEqual({
      questionId: "q1",
      isCorrect: true,
      pointsAwarded: 4,
    });
  });

  it("gives no partial credit for a subset", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["a"] })).toEqual({
      questionId: "q1",
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it("gives nothing for a superset — shotgunning every option must not pay", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["a", "b", "c"] }).isCorrect).toBe(
      false,
    );
  });

  it("ignores duplicates in the learner's selection", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: ["a", "b", "a"] }).isCorrect).toBe(
      true,
    );
  });

  it("rejects an empty selection", () => {
    expect(gradeOne(q, { questionId: "q1", selectedOptionIds: [] }).isCorrect).toBe(false);
  });
});

describe("gradeQuiz — short answer", () => {
  const q = question({
    kind: "short_answer",
    points: 2,
    correctOptionIds: [],
    acceptedAnswers: ["Berlin", "Berlin  Germany"],
  });

  it("matches case-insensitively after trimming", () => {
    expect(gradeOne(q, { questionId: "q1", textAnswer: "  bErLiN " })).toEqual({
      questionId: "q1",
      isCorrect: true,
      pointsAwarded: 2,
    });
  });

  it("collapses internal whitespace on both sides", () => {
    expect(gradeOne(q, { questionId: "q1", textAnswer: "berlin   germany" }).isCorrect).toBe(true);
  });

  it("rejects a different answer", () => {
    expect(gradeOne(q, { questionId: "q1", textAnswer: "Hamburg" }).isCorrect).toBe(false);
  });

  it("treats a blank answer as unanswered even when an empty string is accepted", () => {
    const blankAccepted = question({
      kind: "short_answer",
      correctOptionIds: [],
      acceptedAnswers: [""],
    });
    expect(gradeOne(blankAccepted, { questionId: "q1", textAnswer: "   " }).isCorrect).toBe(false);
    expect(gradeOne(blankAccepted, { questionId: "q1", textAnswer: null }).isCorrect).toBe(false);
  });
});

describe("gradeQuiz — unanswered questions", () => {
  const KINDS: QuizQuestionKind[] = [
    "single_choice",
    "multiple_choice",
    "true_false",
    "short_answer",
  ];

  it("scores 0 and is never correct, for every kind", () => {
    for (const kind of KINDS) {
      const q = question({ kind, points: 5, acceptedAnswers: ["x"] });
      expect(gradeOne(q)).toEqual({ questionId: "q1", isCorrect: false, pointsAwarded: 0 });
    }
  });

  it("still counts towards maxScore, so skipping cannot score 100%", () => {
    const graded = gradeQuiz({
      questions: [
        question({ id: "q1", points: 1 }),
        question({ id: "q2", points: 9, correctOptionIds: ["z"] }),
      ],
      responses: [{ questionId: "q1", selectedOptionIds: ["a"] }],
      passingPercent: 50,
    });
    expect(graded).toEqual({
      results: [
        { questionId: "q1", isCorrect: true, pointsAwarded: 1 },
        { questionId: "q2", isCorrect: false, pointsAwarded: 0 },
      ],
      score: 1,
      maxScore: 10,
      passed: false,
    });
  });
});

describe("gradeQuiz — totals", () => {
  it("returns results in question order, not response order", () => {
    const graded = gradeQuiz({
      questions: [question({ id: "q1" }), question({ id: "q2" }), question({ id: "q3" })],
      responses: [
        { questionId: "q3", selectedOptionIds: ["a"] },
        { questionId: "q1", selectedOptionIds: ["a"] },
      ],
      passingPercent: 70,
    });
    expect(graded.results.map((r) => r.questionId)).toEqual(["q1", "q2", "q3"]);
  });

  it("ignores responses for questions that are not in the quiz", () => {
    const graded = gradeQuiz({
      questions: [question({ id: "q1" })],
      responses: [
        { questionId: "deleted", selectedOptionIds: ["a"] },
        { questionId: "q1", selectedOptionIds: ["a"] },
      ],
      passingPercent: 70,
    });
    expect(graded).toEqual({
      results: [{ questionId: "q1", isCorrect: true, pointsAwarded: 1 }],
      score: 1,
      maxScore: 1,
      passed: true,
    });
  });

  it("passes exactly at the threshold and fails just below it", () => {
    const questions = Array.from({ length: 10 }, (_, index) =>
      question({ id: `q${index}`, points: 1 }),
    );
    const answer = (count: number): QuizResponseInput[] =>
      questions.slice(0, count).map((q) => ({ questionId: q.id, selectedOptionIds: ["a"] }));

    expect(gradeQuiz({ questions, responses: answer(7), passingPercent: 70 }).passed).toBe(true);
    expect(gradeQuiz({ questions, responses: answer(6), passingPercent: 70 }).passed).toBe(false);
  });

  it("does not round the percentage before comparing it", () => {
    // 69.5% would pass a 70% threshold if it were rounded up first.
    const questions = Array.from({ length: 200 }, (_, index) =>
      question({ id: `q${index}`, points: 1 }),
    );
    const responses = questions
      .slice(0, 139)
      .map((q) => ({ questionId: q.id, selectedOptionIds: ["a"] }));
    const graded = gradeQuiz({ questions, responses, passingPercent: 70 });
    expect(graded.score).toBe(139);
    expect(graded.passed).toBe(false);
  });

  it("passes an empty quiz instead of dividing by zero", () => {
    expect(gradeQuiz({ questions: [], responses: [], passingPercent: 70 })).toEqual({
      results: [],
      score: 0,
      maxScore: 0,
      passed: true,
    });
  });

  it("passes a quiz whose questions are all worth zero points", () => {
    const graded = gradeQuiz({
      questions: [question({ id: "q1", points: 0 })],
      responses: [],
      passingPercent: 100,
    });
    expect(graded).toEqual({
      results: [{ questionId: "q1", isCorrect: false, pointsAwarded: 0 }],
      score: 0,
      maxScore: 0,
      passed: true,
    });
  });
});
