import { aliasedTable, and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { adminAudit, user } from "@nilovon-wiki/db/schema/index";

import { instanceAdminProcedure } from "../../lib/instance-admin";
import { firstRow } from "../../lib/rows";
import { AdminAuditEntrySchema, ListAdminAuditInputSchema } from "../../schemas/admin";

const TAGS = ["Admin"];

// Two joins onto the same table need two aliases; both are left joins because a
// deleted account is precisely the case the denormalized email has to cover.
const actorUser = aliasedTable(user, "audit_actor");
const targetUser = aliasedTable(user, "audit_target");

/**
 * The instance audit log. Readable only by instance admins — org owners must
 * not see who was banned or impersonated across other tenants, which is why
 * these events never went into the org-scoped `wiki.activity` feed.
 */
export const adminAuditRouter = {
  list: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/audit",
      tags: TAGS,
      summary: "Instance-wide admin events, newest first",
    })
    .input(ListAdminAuditInputSchema)
    .output(z.object({ items: z.array(AdminAuditEntrySchema), total: z.number().int() }))
    .handler(async ({ input, context }) => {
      const where = and(
        input.targetUserId ? eq(adminAudit.targetUserId, input.targetUserId) : undefined,
        input.action ? eq(adminAudit.action, input.action) : undefined,
      );

      const [items, total] = await Promise.all([
        context.db
          .select({
            id: adminAudit.id,
            action: adminAudit.action,
            actorId: adminAudit.actorId,
            actorEmail: adminAudit.actorEmail,
            actorName: actorUser.name,
            targetUserId: adminAudit.targetUserId,
            targetEmail: adminAudit.targetEmail,
            targetName: targetUser.name,
            metadata: adminAudit.metadata,
            createdAt: adminAudit.createdAt,
          })
          .from(adminAudit)
          .leftJoin(actorUser, eq(adminAudit.actorId, actorUser.id))
          .leftJoin(targetUser, eq(adminAudit.targetUserId, targetUser.id))
          .where(where)
          .orderBy(desc(adminAudit.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        context.db.select({ n: count() }).from(adminAudit).where(where),
      ]);

      return { items, total: firstRow(total).n };
    }),
};
