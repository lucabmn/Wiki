import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@nilovon-wiki/auth";
import { session } from "@nilovon-wiki/db/schema/index";

import { instanceAdminProcedure, nowUtc } from "../../lib/instance-admin";
import {
  AdminActionResultSchema,
  AdminSessionSchema,
  AdminUserRefSchema,
  RevokeSessionInputSchema,
} from "../../schemas/admin";

const TAGS = ["Admin"];

/**
 * The other half of deprovisioning. Disabling an account in the directory (or
 * banning it here) means nothing while its browser tabs keep a live session, so
 * the console has to be able to see and cut them.
 *
 * Revocation is immediate rather than eventually consistent: the audit hooks in
 * `packages/auth` bump the target's session-cookie cache version, so the signed
 * cache stops validating on the very next request instead of five minutes later.
 */
export const adminSessionRouter = {
  list: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/users/{userId}/sessions",
      tags: TAGS,
      summary: "A user's live sessions",
    })
    .input(AdminUserRefSchema)
    .output(z.array(AdminSessionSchema))
    .handler(async ({ input, context }) => {
      const rows = await context.db
        .select({
          id: session.id,
          token: session.token,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          impersonatedBy: session.impersonatedBy,
        })
        .from(session)
        .where(and(eq(session.userId, input.userId), gt(session.expiresAt, nowUtc)))
        .orderBy(desc(session.createdAt));

      const own = context.session.session.token;
      return rows.map((row) => ({ ...row, current: row.token === own }));
    }),

  revoke: instanceAdminProcedure
    .route({
      method: "POST",
      path: "/admin/users/{userId}/sessions/revoke",
      tags: TAGS,
      summary: "Revoke one session",
    })
    .input(RevokeSessionInputSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      await auth.api.revokeUserSession({
        headers: context.headers,
        body: { sessionToken: input.sessionToken },
      });
      return { success: true as const };
    }),

  revokeAll: instanceAdminProcedure
    .route({
      method: "POST",
      path: "/admin/users/{userId}/sessions/revoke-all",
      tags: TAGS,
      summary: "Revoke every session of a user",
    })
    .input(AdminUserRefSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      await auth.api.revokeUserSessions({
        headers: context.headers,
        body: { userId: input.userId },
      });
      return { success: true as const };
    }),
};
