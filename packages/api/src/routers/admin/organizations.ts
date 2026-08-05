import { ORPCError } from "@orpc/server";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { attachment, member, organization, page, space, user } from "@nilovon-wiki/db/schema/index";

import { instanceAdminProcedure } from "../../lib/instance-admin";
import { firstRow } from "../../lib/rows";
import {
  AdminOrganizationDetailSchema,
  AdminOrganizationSummarySchema,
  AdminOrgRefSchema,
  ListAdminOrganizationsInputSchema,
} from "../../schemas/admin";

const TAGS = ["Admin"];

/**
 * Tenant overview for the operator: how many people, how many spaces, how much
 * disk. Deliberately no page titles below the space level and no page content
 * at all — reading what a tenant wrote requires impersonation, which is audited.
 */

/** `sum()` over a bigint column comes back as a numeric string. */
function toBytes(value: string | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * Disk usage per organization, asked as its own query.
 *
 * It cannot ride along on the aggregate below: those joins multiply rows, and
 * while `countDistinct` survives that, `sum` does not — each attachment would
 * be added once per member of the organization.
 */
async function storageByOrganization(
  db: Database,
  organizationIds: string[],
): Promise<Map<string, number>> {
  if (organizationIds.length === 0) return new Map();
  const rows = await db
    .select({ organizationId: space.organizationId, bytes: sum(attachment.size) })
    .from(attachment)
    .innerJoin(space, eq(attachment.spaceId, space.id))
    .where(inArray(space.organizationId, organizationIds))
    .groupBy(space.organizationId);
  return new Map(rows.map((row) => [row.organizationId, toBytes(row.bytes)]));
}

const orgColumns = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  logo: organization.logo,
  createdAt: organization.createdAt,
  // `countDistinct` because the three left joins form a cross product. A
  // correlated subquery would be the obvious alternative and is a trap here:
  // Drizzle renders a column inside a `sql` selection *without* its table
  // prefix, so the outer reference silently binds to the subquery's own table.
  memberCount: countDistinct(member.id),
  // The joins narrow to live spaces and live pages — the numbers a capacity
  // question is actually about.
  spaceCount: countDistinct(space.id),
  pageCount: countDistinct(page.id),
};

function selectOrganizations(db: Database) {
  return db
    .select(orgColumns)
    .from(organization)
    .leftJoin(member, eq(member.organizationId, organization.id))
    .leftJoin(space, and(eq(space.organizationId, organization.id), isNull(space.archivedAt)))
    .leftJoin(page, and(eq(page.spaceId, space.id), isNull(page.archivedAt)))
    .groupBy(organization.id);
}

export const adminOrganizationRouter = {
  list: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/organizations",
      tags: TAGS,
      summary: "Every organization on this instance",
    })
    .input(ListAdminOrganizationsInputSchema)
    .output(z.object({ items: z.array(AdminOrganizationSummarySchema), total: z.number().int() }))
    .handler(async ({ input, context }) => {
      const term = input.query?.trim();
      const where = term
        ? or(ilike(organization.name, `%${term}%`), ilike(organization.slug, `%${term}%`))
        : undefined;

      const [rows, total] = await Promise.all([
        selectOrganizations(context.db)
          .where(where)
          .orderBy(desc(organization.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        context.db.select({ n: count() }).from(organization).where(where),
      ]);

      const storage = await storageByOrganization(
        context.db,
        rows.map((row) => row.id),
      );

      return {
        items: rows.map((row) => ({ ...row, storageBytes: storage.get(row.id) ?? 0 })),
        total: firstRow(total).n,
      };
    }),

  get: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/organizations/{organizationId}",
      tags: TAGS,
      summary: "One organization: owners and space metadata",
    })
    .input(AdminOrgRefSchema)
    .output(AdminOrganizationDetailSchema)
    .handler(async ({ input, context }) => {
      const { db } = context;
      const found = await selectOrganizations(db)
        .where(eq(organization.id, input.organizationId))
        .limit(1);
      const org = found[0];
      if (!org) throw new ORPCError("NOT_FOUND", { message: "Organisation nicht gefunden" });

      const [owners, spaces, storage] = await Promise.all([
        // Who to contact about this tenant — the first thing a support case needs.
        db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(
            and(
              eq(member.organizationId, input.organizationId),
              sql`string_to_array(coalesce(${member.role}, ''), ',') && array['owner']`,
            ),
          )
          .orderBy(user.name),
        db
          .select({
            id: space.id,
            name: space.name,
            slug: space.slug,
            visibility: space.visibility,
            archivedAt: space.archivedAt,
            updatedAt: space.updatedAt,
            pageCount: countDistinct(page.id),
          })
          .from(space)
          .leftJoin(page, and(eq(page.spaceId, space.id), isNull(page.archivedAt)))
          .where(eq(space.organizationId, input.organizationId))
          .groupBy(space.id)
          // Live spaces first — archived ones are still listed, because a
          // support case is often about something that was archived.
          .orderBy(sql`${space.archivedAt} nulls first`, space.name),
        storageByOrganization(db, [input.organizationId]),
      ]);

      const bytesBySpace = await storageBySpace(
        db,
        spaces.map((row) => row.id),
      );

      return {
        ...org,
        storageBytes: storage.get(input.organizationId) ?? 0,
        owners,
        spaces: spaces.map((row) => ({ ...row, storageBytes: bytesBySpace.get(row.id) ?? 0 })),
      };
    }),
};

/** Same reasoning as `storageByOrganization`, one level down. */
async function storageBySpace(db: Database, spaceIds: string[]): Promise<Map<string, number>> {
  if (spaceIds.length === 0) return new Map();
  const rows = await db
    .select({ spaceId: attachment.spaceId, bytes: sum(attachment.size) })
    .from(attachment)
    .where(inArray(attachment.spaceId, spaceIds))
    .groupBy(attachment.spaceId);
  return new Map(rows.map((row) => [row.spaceId, toBytes(row.bytes)]));
}
