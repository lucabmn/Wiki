import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { certificate } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, publicProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requireCourseCapability } from "../lib/learn-authz";
import { loadCourse } from "../lib/learn-loaders";
import { firstRow } from "../lib/rows";
import {
  CertificateSchema,
  ListCourseCertificatesInputSchema,
  PublicCertificateSchema,
  RevokeCertificateInputSchema,
  VerifyCertificateInputSchema,
  type CertificateSubject,
} from "../schemas/certificate";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Certificates"];

export const certificateRouter = {
  listMine: protectedProcedure
    .route({
      method: "GET",
      path: "/certificates/mine",
      tags: TAGS,
      summary: "The certificates the caller holds",
    })
    // GET input must be an object (not z.void()) for the OpenAPI surface.
    .input(z.object({}))
    .output(z.array(CertificateSchema))
    .handler(async ({ context }) => {
      const rows = await context.db.query.certificate.findMany({
        where: eq(certificate.userId, context.session.user.id),
        orderBy: [desc(certificate.issuedAt)],
      });
      return rows.map(toCertificate);
    }),

  get: protectedProcedure
    .route({
      method: "GET",
      path: "/certificates/{id}",
      tags: TAGS,
      summary: "Get one certificate",
    })
    .input(z.object({ id: IdSchema }))
    .output(CertificateSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCertificate(context.db, input.id);
      if (row.userId !== context.session.user.id) {
        // Not the holder, so this has to be staff on the course it was issued
        // for. A purged course leaves nothing to hold a capability on, and an
        // org role is never a substitute — so the certificate simply stops
        // existing for everyone but its holder.
        if (!row.courseId) throw new ORPCError("NOT_FOUND");
        const courseRow = await loadCourse(context.db, row.courseId, { includeTrashed: true });
        await requireCourseCapability(context.db, context, context.headers, courseRow, "view");
      }
      return toCertificate(row);
    }),

  verify: publicProcedure
    .route({
      method: "GET",
      path: "/certificates/verify/{serial}",
      tags: TAGS,
      summary: "Check a certificate by its printed serial, without signing in",
    })
    .input(VerifyCertificateInputSchema)
    .output(PublicCertificateSchema)
    .handler(async ({ input, context }) => {
      const row = await context.db.query.certificate.findFirst({
        where: eq(certificate.serial, input.serial),
      });
      // A wrong serial and a serial that was never issued are the same answer:
      // anything else would let a caller probe for valid codes.
      if (!row) throw new ORPCError("NOT_FOUND", { message: "No certificate with this serial" });

      // This is the endpoint a stranger opens from a printed certificate, so it
      // answers exactly one question — "is this real, and does it still stand?"
      // — from the snapshot. No internal ids (they are the keys to authenticated
      // endpoints), no email, and no `revokedReason`: the reason is free text a
      // staff member wrote about a named person, and `status` already carries
      // everything the verifier is owed.
      const subject = toSubject(row.subject);
      return {
        serial: row.serial,
        status: row.status,
        recipientName: subject.recipientName,
        courseTitle: subject.courseTitle,
        organizationName: subject.organizationName,
        completedAt: subject.completedAt,
        score: subject.score,
        issuedAt: row.issuedAt,
        revokedAt: row.revokedAt,
      };
    }),

  listForCourse: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/certificates",
      tags: TAGS,
      summary: "The certificates issued for a course",
    })
    .input(ListCourseCertificatesInputSchema)
    .output(z.array(CertificateSchema))
    .handler(async ({ input, context }) => {
      // The list names individuals, so it needs the grant that already implies
      // seeing a learner's work — merely viewing the course is not enough. A
      // trashed course is hidden here like on every other `/courses/{id}` read;
      // its certificates stay reachable one by one through `get`.
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "grade");

      const rows = await context.db.query.certificate.findMany({
        where: and(
          eq(certificate.courseId, input.courseId),
          input.status ? eq(certificate.status, input.status) : undefined,
        ),
        orderBy: [desc(certificate.issuedAt)],
        limit: input.limit,
        offset: input.offset,
      });
      return rows.map(toCertificate);
    }),

  revoke: protectedProcedure
    .route({
      method: "POST",
      path: "/certificates/{id}/revoke",
      tags: TAGS,
      summary: "Revoke a certificate, stating why",
    })
    .input(RevokeCertificateInputSchema)
    .output(CertificateSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCertificate(context.db, input.id);
      // Revoking is a management decision about who the organization vouches
      // for, and it is gated on the course the certificate was issued for. Once
      // that course is purged there is nothing left to hold the capability, and
      // an org role must not stand in for it.
      if (!row.courseId) throw new ORPCError("NOT_FOUND");
      const courseRow = await loadCourse(context.db, row.courseId, { includeTrashed: true });
      await requireCourseCapability(context.db, context, context.headers, courseRow, "manage");

      // Already revoked: report the existing record rather than overwriting who
      // revoked it and why.
      if (row.status === "revoked") return toCertificate(row);

      return context.db.transaction(async (tx) => {
        // A certificate is never edited and never deleted, only revoked. It was
        // published to third parties who may have printed or filed it, and a
        // verification that used to succeed has to keep answering — with
        // "revoked" instead of silence, because a serial that stops resolving is
        // indistinguishable from a forgery and tells the verifier nothing.
        const updated = firstRow(
          await tx
            .update(certificate)
            .set({
              status: "revoked",
              revokedAt: new Date(),
              revokedBy: context.session.user.id,
              revokedReason: input.reason,
            })
            .where(eq(certificate.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          // Taken from the certificate, not the course: this column is NOT NULL
          // and survives the course being deleted.
          organizationId: row.organizationId,
          action: "certificate.revoked",
          ...activityActor(context),
          courseId: row.courseId,
          metadata: { certificateId: row.id, serial: row.serial, reason: input.reason },
        });
        return toCertificate(updated);
      });
    }),
};

// ---------------------------------------------------------------------------

/** Loads a certificate or throws NOT_FOUND. */
async function loadCertificate(db: Database, id: string) {
  const row = await db.query.certificate.findFirst({ where: eq(certificate.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Certificate not found" });
  return row;
}

/**
 * The stored snapshot as it comes back out of `jsonb`.
 *
 * Lenient on purpose: the column is typed `unknown`, dates round-trip through
 * JSON as strings, and a certificate issued by an older version of the app must
 * still render rather than fail output validation years later.
 */
const StoredSubjectSchema = z.object({
  recipientName: z.string().catch(""),
  courseTitle: z.string().catch(""),
  organizationName: z.string().catch(""),
  completedAt: z.coerce.date().nullish().catch(null),
  score: z.coerce.number().nullish().catch(null),
});

const EMPTY_SUBJECT: CertificateSubject = {
  recipientName: "",
  courseTitle: "",
  organizationName: "",
  completedAt: null,
  score: null,
};

function toSubject(value: unknown): CertificateSubject {
  const parsed = StoredSubjectSchema.safeParse(value ?? {});
  if (!parsed.success) return EMPTY_SUBJECT;
  return {
    recipientName: parsed.data.recipientName,
    courseTitle: parsed.data.courseTitle,
    organizationName: parsed.data.organizationName,
    completedAt: parsed.data.completedAt ?? null,
    score: parsed.data.score ?? null,
  };
}

/**
 * The wire shape of a certificate. Every handler that returns a row goes
 * through here, because `subject` is `jsonb` — typed `unknown`, so nothing but
 * this coercion stands between a stored ISO string and a failed output
 * validation at runtime.
 */
function toCertificate(row: typeof certificate.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    courseId: row.courseId,
    enrollmentId: row.enrollmentId,
    userId: row.userId,
    serial: row.serial,
    subject: toSubject(row.subject),
    status: row.status,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
  };
}
