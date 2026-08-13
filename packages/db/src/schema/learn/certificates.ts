import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../_helpers";
import { organization, user } from "../auth";
import { learnSchema } from "./_schema";
import { certificateStatus } from "./enums";
import { course } from "./courses";
import { enrollment } from "./enrollment";

/**
 * Proof that a named person completed a named course on a named date.
 *
 * Every fact a verifier needs is snapshotted into `subject`, because a
 * certificate has to stay readable after the course was renamed, the account
 * was deleted, or the organization changed its name. The foreign keys are for
 * navigation inside the app; the snapshot is what the certificate *says*.
 */
export const certificate = learnSchema.table(
  "certificate",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    courseId: text("course_id").references(() => course.id, { onDelete: "set null" }),
    enrollmentId: text("enrollment_id").references(() => enrollment.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * The public code printed on the certificate and used to look it up without
     * a session. Unguessable, so knowing it is the only proof of possession the
     * verification endpoint requires.
     */
    serial: text("serial").notNull(),
    /**
     * Frozen at issue time:
     * `{ recipientName, courseTitle, organizationName, completedAt, score }`.
     */
    subject: jsonb("subject").notNull(),
    status: certificateStatus("status").notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
    revokedReason: text("revoked_reason"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("certificate_serial_uq").on(t.serial),
    // One certificate per enrolment: re-running the completion check must be
    // idempotent, not print a second copy.
    uniqueIndex("certificate_enrollment_uq").on(t.enrollmentId),
    index("certificate_user_idx").on(t.userId),
    index("certificate_course_idx").on(t.courseId),
  ],
);
