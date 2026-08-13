import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { certificate, organization } from "@nilovon-wiki/db/schema/index";

/**
 * Issuing completion certificates.
 *
 * A certificate is a statement about a person that has to stay true after the
 * course was renamed, the account was deleted or the organization changed its
 * name — so everything a reader needs is copied into `certificate.subject` at
 * issue time. The foreign keys are for navigation inside the app; the snapshot
 * is what the certificate *says*.
 */

// Accepts either the db handle or a transaction — both expose `insert`/`select`
// with the same signature, so issuing happens inside the caller's transaction
// and rolls back with the completion that triggered it.
type Executor = { insert: Database["insert"]; select: Database["select"] };

/**
 * Human-friendly alphabet: Crockford's base32 without `I`, `L`, `O` and `U`, so
 * a serial read off a printed page cannot be mistyped into a different valid
 * one (and cannot spell anything).
 */
const SERIAL_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SERIAL_GROUPS = 4;
const SERIAL_GROUP_SIZE = 4;

/**
 * A new public certificate code, e.g. `7K3M-9QW2-XZ04-HB5T`.
 *
 * Knowing the serial is the only proof of possession `certificate.verify`
 * requires — it is the endpoint a stranger opens from a printed certificate,
 * with no session. So the code must be unguessable: never sequential, never
 * derived from the course or the holder's id, or anyone who knows one
 * certificate could enumerate every other one.
 *
 * Drawn from Web Crypto rather than `node:crypto` because this package runs on
 * both Bun and Node, and `crypto.getRandomValues` is the CSPRNG both provide.
 */
export function generateSerial(): string {
  const length = SERIAL_GROUPS * SERIAL_GROUP_SIZE;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 is an exact multiple of the 32-character alphabet, so the modulo maps
  // every byte onto a character with equal probability.
  const chars = Array.from(bytes, (byte) => SERIAL_ALPHABET[byte % SERIAL_ALPHABET.length]);
  const groups: string[] = [];
  for (let index = 0; index < length; index += SERIAL_GROUP_SIZE) {
    groups.push(chars.slice(index, index + SERIAL_GROUP_SIZE).join(""));
  }
  return groups.join("-");
}

export type IssueCertificateInput = {
  enrollment: {
    id: string;
    courseId: string;
    userId: string;
    completedAt: Date | null;
    progressPercent: number;
  };
  course: { id: string; organizationId: string; title: string };
  /** The holder, or null when the account is already gone. */
  user: { id: string; name: string } | null;
};

/**
 * Issues the certificate for one completed enrolment, or returns the one that
 * already exists.
 *
 * Idempotent by contract, not by luck: the completion check runs on every
 * progress write, and a learner who finishes the last lesson twice must not end
 * up holding two certificates with two different serials. The unique index on
 * `certificate.enrollment_id` is what makes the second call a no-op even when
 * two requests race, which is why the insert conflicts rather than fails.
 */
export async function issueCertificate(
  tx: Executor,
  input: IssueCertificateInput,
): Promise<{ id: string; serial: string }> {
  const existing = await findByEnrollment(tx, input.enrollment.id);
  if (existing) return existing;

  // Read the org name now: after a rename the certificate must keep naming the
  // organization that actually granted it.
  const [org] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, input.course.organizationId))
    .limit(1);

  const rows = await tx
    .insert(certificate)
    .values({
      organizationId: input.course.organizationId,
      courseId: input.course.id,
      enrollmentId: input.enrollment.id,
      userId: input.enrollment.userId,
      serial: generateSerial(),
      subject: {
        // The recipient's name as it was when they earned it — a later rename
        // does not change who completed the course on that date.
        recipientName: input.user?.name ?? "",
        courseTitle: input.course.title,
        organizationName: org?.name ?? "",
        completedAt: input.enrollment.completedAt,
        score: input.enrollment.progressPercent,
      },
    })
    .onConflictDoNothing({ target: certificate.enrollmentId })
    .returning({ id: certificate.id, serial: certificate.serial });

  const inserted = rows[0];
  if (inserted) return inserted;

  // The conflict fired: a concurrent completion issued it first. Read theirs
  // rather than retrying, so both callers report the same serial.
  const raced = await findByEnrollment(tx, input.enrollment.id);
  if (raced) return raced;
  throw new Error(`Failed to issue a certificate for enrollment ${input.enrollment.id}`);
}

async function findByEnrollment(
  tx: Executor,
  enrollmentId: string,
): Promise<{ id: string; serial: string } | null> {
  const [row] = await tx
    .select({ id: certificate.id, serial: certificate.serial })
    .from(certificate)
    .where(eq(certificate.enrollmentId, enrollmentId))
    .limit(1);
  return row ?? null;
}
