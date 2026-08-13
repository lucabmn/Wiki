import { z } from "zod";

import { IdSchema } from "./shared";

/**
 * Certificate I/O contracts. Hand-written rather than derived from the drizzle
 * table, because a certificate is read by two very different audiences — its
 * holder inside the app, and an anonymous stranger holding a printed serial —
 * and what each of them is told has to be a decision, not a column list.
 */

export const CertificateStatusSchema = z.enum(["issued", "revoked"]);

/**
 * The facts frozen into `certificate.subject` at issue time. This is what the
 * certificate says; the foreign keys next to it only say where it came from,
 * and they null out when the course or the account is deleted.
 */
export const CertificateSubjectSchema = z.object({
  recipientName: z.string(),
  courseTitle: z.string(),
  organizationName: z.string(),
  completedAt: z.date().nullable(),
  /** Completion percentage at the moment of issue. */
  score: z.number().nullable(),
});
export type CertificateSubject = z.infer<typeof CertificateSubjectSchema>;

/** A certificate as its holder and the course's staff see it. */
export const CertificateSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  /** Null once the course was purged — the snapshot outlives it. */
  courseId: IdSchema.nullable(),
  enrollmentId: IdSchema.nullable(),
  userId: IdSchema.nullable(),
  serial: z.string(),
  subject: CertificateSubjectSchema,
  status: CertificateStatusSchema,
  issuedAt: z.date(),
  revokedAt: z.date().nullable(),
  revokedReason: z.string().nullable(),
});
export type Certificate = z.infer<typeof CertificateSchema>;

/**
 * What the unauthenticated verification endpoint discloses.
 *
 * Deliberately not `CertificateSchema.omit(...)`: this shape is an allowlist,
 * so a column added to the table later cannot leak by being forgotten here. It
 * carries the snapshot facts and whether the certificate still stands — enough
 * to answer "is this real?" — and nothing that identifies the holder beyond the
 * name already printed on the paper the verifier is holding.
 */
export const PublicCertificateSchema = z.object({
  serial: z.string(),
  status: CertificateStatusSchema,
  recipientName: z.string(),
  courseTitle: z.string(),
  organizationName: z.string(),
  completedAt: z.date().nullable(),
  score: z.number().nullable(),
  issuedAt: z.date(),
  revokedAt: z.date().nullable(),
});

export const VerifyCertificateInputSchema = z.object({
  serial: z.string().min(1).max(64),
});

export const ListCourseCertificatesInputSchema = z.object({
  courseId: IdSchema,
  status: CertificateStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const RevokeCertificateInputSchema = z.object({
  id: IdSchema,
  /**
   * Required: revoking is a public statement that a qualification no longer
   * stands, and the holder is entitled to be told on what grounds.
   */
  reason: z.string().min(1).max(500),
});
