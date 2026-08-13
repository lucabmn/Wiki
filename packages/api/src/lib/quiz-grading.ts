/**
 * Quiz grading.
 *
 * The scoring rules live here rather than in the router so the thing that
 * decides whether a learner passed is a pure function of the questions and the
 * answers — no db, no session, no clock. That is what lets the truth table be
 * enumerated in a unit test instead of reconstructed from fixtures, and it is
 * the same discipline `course-access.ts` follows for the access decision.
 *
 * Everything here is deliberately deterministic: shuffling a question order is
 * a presentation concern and stays in the router, because a grader that reached
 * for `Math.random` could no longer be pinned by a test.
 */

export type QuizQuestionKind = "single_choice" | "multiple_choice" | "true_false" | "short_answer";

/** One question as the grader needs it — the answer key, not the wire shape. */
export type GradableQuestion = {
  id: string;
  kind: QuizQuestionKind;
  /** Points awarded when the answer is fully correct. */
  points: number;
  /** Ids of the options marked correct. Empty for `short_answer`. */
  correctOptionIds: string[];
  /** `short_answer` only: every spelling the author accepts. */
  acceptedAnswers: string[];
};

/** What the learner sent back for one question. */
export type QuizResponseInput = {
  questionId: string;
  /** Chosen option ids — one for the single-answer kinds, n for multiple. */
  selectedOptionIds?: string[];
  /** `short_answer` only: what the learner typed, verbatim. */
  textAnswer?: string | null;
};

export type GradedQuestion = {
  questionId: string;
  isCorrect: boolean;
  pointsAwarded: number;
};

export type GradedQuiz = {
  /** One entry per question, in question order — never in response order. */
  results: GradedQuestion[];
  score: number;
  maxScore: number;
  passed: boolean;
};

export type GradeQuizInput = {
  questions: GradableQuestion[];
  responses: QuizResponseInput[];
  /** `quiz.passingPercent` — percent of `maxScore` needed to pass. */
  passingPercent: number;
};

/**
 * Collapses a free-text answer to its comparable form: trimmed, internal
 * whitespace collapsed to single spaces, lowercased. Applied to *both* sides of
 * the comparison, so an author who typed "  Berlin " in the answer key still
 * matches a learner who typed "berlin".
 */
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when both sides contain exactly the same ids, order and repeats aside. */
function sameOptionSet(selected: string[], correct: string[]): boolean {
  // The learner's selection is deduped first: a client that sent the same id
  // twice chose that option once, and must not fail an otherwise correct answer.
  const chosen = new Set(selected);
  const expected = new Set(correct);
  if (chosen.size !== expected.size) return false;
  for (const id of expected) {
    if (!chosen.has(id)) return false;
  }
  return true;
}

/** Whether one question was answered correctly. */
function isAnswerCorrect(question: GradableQuestion, response: QuizResponseInput): boolean {
  switch (question.kind) {
    // `true_false` is a two-option choice question and grades identically to
    // `single_choice`; it exists as its own kind only so the UI can render it
    // as a toggle rather than a radio list.
    case "single_choice":
    case "true_false": {
      const selected = [...new Set(response.selectedOptionIds ?? [])];
      // Exactly one option, and it has to be the correct one. Selecting two on
      // a single-answer question is an invalid answer, not a lucky hit.
      if (selected.length !== 1) return false;
      return question.correctOptionIds.includes(selected[0]!);
    }
    case "multiple_choice": {
      const selected = response.selectedOptionIds ?? [];
      if (selected.length === 0) return false;
      // The selected set must equal the correct set exactly. Partial credit is
      // deliberately not awarded: on an exact-set question it rewards
      // shotgunning — ticking every option would always earn a share of the
      // points — so a half-right answer is a wrong answer.
      return sameOptionSet(selected, question.correctOptionIds);
    }
    case "short_answer": {
      const typed = normalizeText(response.textAnswer ?? "");
      // A blank answer is unanswered, even if the author left an empty string
      // among the accepted answers.
      if (typed === "") return false;
      return question.acceptedAnswers.some((accepted) => normalizeText(accepted) === typed);
    }
  }
}

/**
 * Grades one attempt.
 *
 * `maxScore` sums *every* question, answered or not, so skipping a question
 * costs its points rather than shrinking the denominator — otherwise answering
 * a single easy question and leaving the rest blank would score 100%.
 */
export function gradeQuiz(input: GradeQuizInput): GradedQuiz {
  // Responses for questions that are not in this quiz are ignored rather than
  // rejected: a stale client can hold a question that was deleted mid-attempt.
  const byQuestion = new Map<string, QuizResponseInput>();
  for (const response of input.responses) {
    byQuestion.set(response.questionId, response);
  }

  const results: GradedQuestion[] = input.questions.map((question) => {
    const response = byQuestion.get(question.id);
    // An unanswered question scores 0 and is not "correct" — there is no
    // question kind whose empty answer can be right.
    const isCorrect = response ? isAnswerCorrect(question, response) : false;
    return {
      questionId: question.id,
      isCorrect,
      pointsAwarded: isCorrect ? question.points : 0,
    };
  });

  const score = results.reduce((sum, result) => sum + result.pointsAwarded, 0);
  const maxScore = input.questions.reduce((sum, question) => sum + question.points, 0);

  // A quiz worth no points has nothing to fail: dividing would produce NaN,
  // which the output schema would then reject as a 500 on an empty quiz.
  const percent = maxScore > 0 ? (score / maxScore) * 100 : 100;
  // Compared unrounded — rounding first would let 69.5% pass a 70% threshold.
  const passed = percent >= input.passingPercent;

  return { results, score, maxScore, passed };
}
