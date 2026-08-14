import { assignmentRouter } from "./assignment";
import { certificateRouter } from "./certificate";
import { chapterRouter } from "./chapter";
import { commerceRouter } from "./commerce";
import { courseRouter } from "./course";
import { courseAssetRouter } from "./course-asset";
import { courseCollectionRouter } from "./course-collection";
import { courseMemberRouter } from "./course-member";
import { courseTopicRouter } from "./course-topic";
import { courseUpdateRouter } from "./course-update";
import { enrollmentRouter } from "./enrollment";
import { learnAnalyticsRouter } from "./learn-analytics";
import { lessonRouter } from "./lesson";
import { quizRouter } from "./quiz";
import { submissionRouter } from "./submission";

/**
 * The learning platform's API surface, grouped under one namespace.
 *
 * Nested rather than spread into `appRouter` for two reasons. It says what the
 * product is — a peer of the wiki that shares an organization and nothing else,
 * with its own access rules in `lib/course-access.ts`. And it keeps the
 * inferred type of each router node small enough for the compiler to serialize:
 * this package emits declarations, and one flat object holding both products'
 * routers exceeds the limit TypeScript will write out.
 */
export const learnRouter = {
  courses: courseRouter,
  courseMembers: courseMemberRouter,
  courseTopics: courseTopicRouter,
  courseCollections: courseCollectionRouter,
  // Announcements and learner reviews share a module: both are things people
  // write *about* a course rather than parts of the course itself.
  courseUpdates: courseUpdateRouter,
  chapters: chapterRouter,
  lessons: lessonRouter,
  enrollments: enrollmentRouter,
  assignments: assignmentRouter,
  submissions: submissionRouter,
  quizzes: quizRouter,
  certificates: certificateRouter,
  analytics: learnAnalyticsRouter,
  assets: courseAssetRouter,
  // Paid access, modelled as entitlement rather than around a payment
  // processor — see the module comment in `commerce.ts`.
  commerce: commerceRouter,
};
