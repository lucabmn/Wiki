import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { legalHold, page, space } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { assertSpaceRead } from "../lib/access";
import { loadPage, loadSpace } from "../lib/loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { loadHoldScope, type HoldScope } from "../lib/retention/holds";
import { firstRow } from "../lib/rows";
import {
  CreateLegalHoldInputSchema,
  HoldStatusInputSchema,
  HoldStatusSchema,
  LegalHoldSchema,
  ListLegalHoldsInputSchema,
  ReleaseLegalHoldInputSchema,
} from "../schemas/retention";

const TAGS = ["Legal hold"];

/**
 * Deletion blocks.
 *
 * Setting and releasing both require org-level `organization:["update"]` — the
 * same grant. So the guarantee here is *evidentiary*, not preventive: a release
 * cannot happen quietly. It is a separate event, it carries a mandatory reason,
 * it names the instance admin when made under an impersonated session, and
 * neither the block nor its release can be removed by any retention window.
 *
 * A genuinely preventive block needs an authority above the organization, and
 * `instanceAdminProcedure` (`lib/instance-admin.ts`) now provides one. Gating the
 * *release* on it is a deliberate follow-up rather than part of this change: on an
 * install where nobody set `INITIAL_ADMIN_EMAIL` there is no instance admin, and
 * a block nobody can lift is its own kind of broken. That trade-off deserves its
 * own decision, not a side effect of adding the feature.
 */
export const legalHoldRouter = {
  list: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "GET",
      path: "/legal-holds",
      tags: TAGS,
      summary: "Deletion blocks in the active organization",
    })
    .input(ListLegalHoldsInputSchema)
    .output(z.array(LegalHoldSchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const rows = await context.db.query.legalHold.findMany({
        where: and(
          eq(legalHold.organizationId, organizationId),
          input.includeReleased ? undefined : isNull(legalHold.releasedAt),
          input.subjectId ? eq(legalHold.subjectId, input.subjectId) : undefined,
        ),
        orderBy: [desc(legalHold.createdAt)],
      });
      return Promise.all(
        rows.map(async (row) => ({ ...row, subjectLabel: await subjectLabel(context.db, row) })),
      );
    }),

  /**
   * Whether one object is blocked right now — the question the page header and
   * the space settings ask to explain a disabled "Delete" button. Read-only, so
   * read access to the object is the right gate: a user who can open a page is
   * entitled to know why they cannot delete it.
   */
  status: protectedProcedure
    .route({
      method: "GET",
      path: "/legal-holds/status",
      tags: TAGS,
      summary: "Whether a page or space is currently blocked from deletion",
    })
    .input(HoldStatusInputSchema)
    .output(HoldStatusSchema)
    .handler(async ({ input, context }) => {
      const target = input.pageId
        ? await loadPage(context.db, input.pageId, { includeTrashed: true })
        : null;
      const spaceId = target?.spaceId ?? input.spaceId!;
      const spaceRow = await loadSpace(context.db, spaceId, { includeTrashed: true });
      await assertSpaceRead(context.db, context, spaceRow);

      const scope = await loadHoldScope(context.db, spaceRow.organizationId);
      // Reported innermost-first: the most specific block is the one a user can
      // act on, and naming the org when a page-level block exists is misleading.
      const match = resolveInnermostHold(scope, {
        pageId: target?.id,
        spaceId,
        organizationId: spaceRow.organizationId,
      });
      if (!match) return { held: false, source: "none", reason: null, holdId: null };

      const row = await context.db.query.legalHold.findFirst({
        where: and(
          eq(legalHold.subject, match.subject),
          eq(legalHold.subjectId, match.id),
          isNull(legalHold.releasedAt),
        ),
        columns: { id: true, reason: true },
      });
      return {
        held: true,
        source: match.subject,
        reason: row?.reason ?? null,
        holdId: row?.id ?? null,
      };
    }),

  create: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "POST",
      path: "/legal-holds",
      tags: TAGS,
      summary: "Block an object from being deleted",
    })
    .input(CreateLegalHoldInputSchema)
    .output(LegalHoldSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const subjectId = await resolveSubject(context.db, organizationId, input);
      const userId = context.session.user.id;
      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const rows = await tx
              .insert(legalHold)
              .values({
                organizationId,
                subject: input.subject,
                subjectId,
                reason: input.reason,
                createdBy: userId,
              })
              .returning();
            const row = firstRow(rows);
            await recordActivity(tx, {
              organizationId,
              action: "hold.created",
              // Attributed to the impersonating admin as well, when there is
              // one: a block set under a borrowed identity must not read as the
              // borrowed account's own decision.
              ...activityActor(context),
              spaceId: input.subject === "space" ? subjectId : null,
              pageId: input.subject === "page" ? subjectId : null,
              metadata: { holdId: row.id, subject: row.subject, reason: row.reason },
            });
            return { ...row, subjectLabel: await subjectLabel(tx, row) };
          }),
        "Für dieses Objekt besteht bereits eine Löschsperre",
      );
    }),

  release: requireOrgPermission({ organization: ["update"] })
    .route({
      method: "POST",
      path: "/legal-holds/{id}/release",
      tags: TAGS,
      summary: "Lift a deletion block, with a reason",
    })
    .input(ReleaseLegalHoldInputSchema)
    .output(LegalHoldSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await context.db.query.legalHold.findFirst({
        where: and(eq(legalHold.id, input.id), eq(legalHold.organizationId, organizationId)),
      });
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Löschsperre nicht gefunden" });
      if (existing.releasedAt) {
        throw new ORPCError("CONFLICT", { message: "Diese Löschsperre ist bereits aufgehoben" });
      }
      const userId = context.session.user.id;
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(legalHold)
          .set({ releasedAt: new Date(), releasedBy: userId, releaseReason: input.reason })
          // Guarded so two concurrent releases cannot both claim to be the one
          // that lifted it — the second finds no row and fails loudly.
          .where(and(eq(legalHold.id, existing.id), isNull(legalHold.releasedAt)))
          .returning();
        if (rows.length === 0) {
          throw new ORPCError("CONFLICT", { message: "Diese Löschsperre ist bereits aufgehoben" });
        }
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "hold.released",
          ...activityActor(context),
          spaceId: row.subject === "space" ? row.subjectId : null,
          pageId: row.subject === "page" ? row.subjectId : null,
          metadata: { holdId: row.id, subject: row.subject, reason: input.reason },
        });
        return { ...row, subjectLabel: await subjectLabel(tx, row) };
      });
    }),
};

type HoldSubject = "organization" | "space" | "page";
type SubjectRef = { subject: HoldSubject; subjectId: string };
/** The read surface both the db handle and a transaction expose. */
type Reader = Pick<Database, "query">;

/** The most specific active block covering a target, or null when it is free. */
function resolveInnermostHold(
  scope: HoldScope,
  target: { pageId?: string; spaceId: string; organizationId: string },
): { subject: HoldSubject; id: string } | null {
  if (target.pageId && scope.pageIds.has(target.pageId)) {
    return { subject: "page", id: target.pageId };
  }
  if (scope.spaceIds.has(target.spaceId)) return { subject: "space", id: target.spaceId };
  if (scope.organization) return { subject: "organization", id: target.organizationId };
  return null;
}

/**
 * Validates that the named object exists in this organization before a hold is
 * written. The column carries no foreign key on purpose (a cascade could delete
 * the hold along with the row it protects), so integrity is established here —
 * and cross-org: a hold in one org must never reach into another's data.
 */
async function resolveSubject(
  db: Database,
  organizationId: string,
  input: { subject: HoldSubject; subjectId?: string },
): Promise<string> {
  if (input.subject === "organization") return organizationId;
  if (!input.subjectId) {
    throw new ORPCError("BAD_REQUEST", { message: "subjectId is required for this subject" });
  }
  if (input.subject === "space") {
    const row = await loadSpace(db, input.subjectId, { includeTrashed: true });
    if (row.organizationId !== organizationId) throw new ORPCError("FORBIDDEN");
    return row.id;
  }
  const target = await loadPage(db, input.subjectId, { includeTrashed: true });
  const spaceRow = await loadSpace(db, target.spaceId, { includeTrashed: true });
  if (spaceRow.organizationId !== organizationId) throw new ORPCError("FORBIDDEN");
  return target.id;
}

/** Human label for a held object, resolved for display only. */
async function subjectLabel(db: Reader, row: SubjectRef): Promise<string | null> {
  if (row.subject === "organization") return null;
  if (row.subject === "space") {
    const found = await db.query.space.findFirst({
      where: eq(space.id, row.subjectId),
      columns: { name: true },
    });
    return found?.name ?? null;
  }
  const found = await db.query.page.findFirst({
    where: eq(page.id, row.subjectId),
    columns: { title: true },
  });
  return found?.title ?? null;
}
