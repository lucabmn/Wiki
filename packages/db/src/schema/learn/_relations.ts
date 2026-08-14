import { relations } from "drizzle-orm";

import { organization, team, user } from "../auth";
import { chapter, lesson } from "./chapters";
import {
  assignment,
  assignmentTask,
  submission,
  submissionGrade,
  submissionTask,
} from "./assignments";
import { certificate } from "./certificates";
import { entitlement, product, productPrice, purchase } from "./commerce";
import {
  collectionCourse,
  course,
  courseAsset,
  courseCollection,
  courseMember,
  courseReview,
  courseTopic,
  courseTopicLink,
  courseUpdate,
} from "./courses";
import { chapterRelease, enrollment, lessonProgress } from "./enrollment";
import { quiz, quizAttempt, quizOption, quizQuestion, quizResponse } from "./quizzes";

/**
 * Relations live in one file so table modules can reference each other without
 * import cycles — same arrangement as `wiki/_relations.ts`.
 */

export const courseRelations = relations(course, ({ one, many }) => ({
  organization: one(organization, {
    fields: [course.organizationId],
    references: [organization.id],
  }),
  creator: one(user, { fields: [course.createdBy], references: [user.id] }),
  thumbnail: one(courseAsset, {
    fields: [course.thumbnailAssetId],
    references: [courseAsset.id],
    relationName: "course_thumbnail",
  }),
  chapters: many(chapter),
  lessons: many(lesson),
  members: many(courseMember),
  enrollments: many(enrollment),
  updates: many(courseUpdate),
  reviews: many(courseReview),
  topics: many(courseTopicLink),
  collections: many(collectionCourse),
  assets: many(courseAsset, { relationName: "course_assets" }),
  quizzes: many(quiz),
  assignments: many(assignment),
  certificates: many(certificate),
}));

export const courseMemberRelations = relations(courseMember, ({ one }) => ({
  course: one(course, { fields: [courseMember.courseId], references: [course.id] }),
  user: one(user, { fields: [courseMember.userId], references: [user.id] }),
  team: one(team, { fields: [courseMember.teamId], references: [team.id] }),
}));

export const courseAssetRelations = relations(courseAsset, ({ one }) => ({
  course: one(course, {
    fields: [courseAsset.courseId],
    references: [course.id],
    relationName: "course_assets",
  }),
  uploader: one(user, { fields: [courseAsset.uploadedBy], references: [user.id] }),
}));

export const courseCollectionRelations = relations(courseCollection, ({ one, many }) => ({
  organization: one(organization, {
    fields: [courseCollection.organizationId],
    references: [organization.id],
  }),
  courses: many(collectionCourse),
}));

export const collectionCourseRelations = relations(collectionCourse, ({ one }) => ({
  collection: one(courseCollection, {
    fields: [collectionCourse.collectionId],
    references: [courseCollection.id],
  }),
  course: one(course, { fields: [collectionCourse.courseId], references: [course.id] }),
}));

export const courseTopicRelations = relations(courseTopic, ({ many }) => ({
  courses: many(courseTopicLink),
}));

export const courseTopicLinkRelations = relations(courseTopicLink, ({ one }) => ({
  course: one(course, { fields: [courseTopicLink.courseId], references: [course.id] }),
  topic: one(courseTopic, { fields: [courseTopicLink.topicId], references: [courseTopic.id] }),
}));

export const courseUpdateRelations = relations(courseUpdate, ({ one }) => ({
  course: one(course, { fields: [courseUpdate.courseId], references: [course.id] }),
  author: one(user, { fields: [courseUpdate.createdBy], references: [user.id] }),
}));

export const courseReviewRelations = relations(courseReview, ({ one }) => ({
  course: one(course, { fields: [courseReview.courseId], references: [course.id] }),
  user: one(user, { fields: [courseReview.userId], references: [user.id] }),
}));

export const chapterRelations = relations(chapter, ({ one, many }) => ({
  course: one(course, { fields: [chapter.courseId], references: [course.id] }),
  lessons: many(lesson),
  releases: many(chapterRelease),
}));

export const lessonRelations = relations(lesson, ({ one, many }) => ({
  course: one(course, { fields: [lesson.courseId], references: [course.id] }),
  chapter: one(chapter, { fields: [lesson.chapterId], references: [chapter.id] }),
  asset: one(courseAsset, { fields: [lesson.assetId], references: [courseAsset.id] }),
  creator: one(user, { fields: [lesson.createdBy], references: [user.id] }),
  progress: many(lessonProgress),
  assignment: one(assignment),
}));

export const enrollmentRelations = relations(enrollment, ({ one, many }) => ({
  course: one(course, { fields: [enrollment.courseId], references: [course.id] }),
  user: one(user, { fields: [enrollment.userId], references: [user.id] }),
  lastLesson: one(lesson, { fields: [enrollment.lastLessonId], references: [lesson.id] }),
  progress: many(lessonProgress),
  releases: many(chapterRelease),
  certificate: one(certificate),
}));

export const lessonProgressRelations = relations(lessonProgress, ({ one }) => ({
  enrollment: one(enrollment, {
    fields: [lessonProgress.enrollmentId],
    references: [enrollment.id],
  }),
  lesson: one(lesson, { fields: [lessonProgress.lessonId], references: [lesson.id] }),
}));

export const chapterReleaseRelations = relations(chapterRelease, ({ one }) => ({
  enrollment: one(enrollment, {
    fields: [chapterRelease.enrollmentId],
    references: [enrollment.id],
  }),
  chapter: one(chapter, { fields: [chapterRelease.chapterId], references: [chapter.id] }),
}));

export const assignmentRelations = relations(assignment, ({ one, many }) => ({
  course: one(course, { fields: [assignment.courseId], references: [course.id] }),
  lesson: one(lesson, { fields: [assignment.lessonId], references: [lesson.id] }),
  tasks: many(assignmentTask),
  submissions: many(submission),
}));

export const assignmentTaskRelations = relations(assignmentTask, ({ one, many }) => ({
  assignment: one(assignment, {
    fields: [assignmentTask.assignmentId],
    references: [assignment.id],
  }),
  quiz: one(quiz, { fields: [assignmentTask.quizId], references: [quiz.id] }),
  answers: many(submissionTask),
}));

export const submissionRelations = relations(submission, ({ one, many }) => ({
  assignment: one(assignment, {
    fields: [submission.assignmentId],
    references: [assignment.id],
  }),
  user: one(user, { fields: [submission.userId], references: [user.id] }),
  grader: one(user, { fields: [submission.gradedBy], references: [user.id] }),
  tasks: many(submissionTask),
  grades: many(submissionGrade),
}));

export const submissionTaskRelations = relations(submissionTask, ({ one }) => ({
  submission: one(submission, {
    fields: [submissionTask.submissionId],
    references: [submission.id],
  }),
  task: one(assignmentTask, {
    fields: [submissionTask.taskId],
    references: [assignmentTask.id],
  }),
  asset: one(courseAsset, { fields: [submissionTask.assetId], references: [courseAsset.id] }),
  quizAttempt: one(quizAttempt, {
    fields: [submissionTask.quizAttemptId],
    references: [quizAttempt.id],
  }),
}));

export const submissionGradeRelations = relations(submissionGrade, ({ one }) => ({
  submission: one(submission, {
    fields: [submissionGrade.submissionId],
    references: [submission.id],
  }),
  grader: one(user, { fields: [submissionGrade.gradedBy], references: [user.id] }),
}));

export const quizRelations = relations(quiz, ({ one, many }) => ({
  course: one(course, { fields: [quiz.courseId], references: [course.id] }),
  questions: many(quizQuestion),
  attempts: many(quizAttempt),
}));

export const quizQuestionRelations = relations(quizQuestion, ({ one, many }) => ({
  quiz: one(quiz, { fields: [quizQuestion.quizId], references: [quiz.id] }),
  options: many(quizOption),
  responses: many(quizResponse),
}));

export const quizOptionRelations = relations(quizOption, ({ one }) => ({
  question: one(quizQuestion, {
    fields: [quizOption.questionId],
    references: [quizQuestion.id],
  }),
}));

export const quizAttemptRelations = relations(quizAttempt, ({ one, many }) => ({
  quiz: one(quiz, { fields: [quizAttempt.quizId], references: [quiz.id] }),
  user: one(user, { fields: [quizAttempt.userId], references: [user.id] }),
  lesson: one(lesson, { fields: [quizAttempt.lessonId], references: [lesson.id] }),
  responses: many(quizResponse),
}));

export const quizResponseRelations = relations(quizResponse, ({ one }) => ({
  attempt: one(quizAttempt, { fields: [quizResponse.attemptId], references: [quizAttempt.id] }),
  question: one(quizQuestion, {
    fields: [quizResponse.questionId],
    references: [quizQuestion.id],
  }),
}));

export const certificateRelations = relations(certificate, ({ one }) => ({
  course: one(course, { fields: [certificate.courseId], references: [course.id] }),
  enrollment: one(enrollment, {
    fields: [certificate.enrollmentId],
    references: [enrollment.id],
  }),
  user: one(user, { fields: [certificate.userId], references: [user.id] }),
}));

export const productRelations = relations(product, ({ one, many }) => ({
  course: one(course, { fields: [product.courseId], references: [course.id] }),
  collection: one(courseCollection, {
    fields: [product.collectionId],
    references: [courseCollection.id],
  }),
  prices: many(productPrice),
  purchases: many(purchase),
  entitlements: many(entitlement),
}));

export const productPriceRelations = relations(productPrice, ({ one }) => ({
  product: one(product, { fields: [productPrice.productId], references: [product.id] }),
}));

export const purchaseRelations = relations(purchase, ({ one }) => ({
  product: one(product, { fields: [purchase.productId], references: [product.id] }),
  price: one(productPrice, { fields: [purchase.priceId], references: [productPrice.id] }),
  user: one(user, { fields: [purchase.userId], references: [user.id] }),
}));

export const entitlementRelations = relations(entitlement, ({ one }) => ({
  product: one(product, { fields: [entitlement.productId], references: [product.id] }),
  user: one(user, { fields: [entitlement.userId], references: [user.id] }),
  purchase: one(purchase, { fields: [entitlement.purchaseId], references: [purchase.id] }),
}));
