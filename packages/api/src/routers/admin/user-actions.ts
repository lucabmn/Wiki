import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import { auth } from "@nilovon-wiki/auth";
import { recordAdminAudit } from "@nilovon-wiki/auth/admin-audit";
import { user } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { instanceAdminProcedure } from "../../lib/instance-admin";
import {
  AdminActionResultSchema,
  AdminUserRefSchema,
  BanUserInputSchema,
  SetInstanceRoleInputSchema,
} from "../../schemas/admin";
import { assertNotLastAdmin } from "./users";

const TAGS = ["Admin"];
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Every mutation delegates to Better Auth's `admin()` endpoints rather than
 * writing to the tables directly. That is what keeps three things in one place:
 * the plugin's own authorization (a second gate behind
 * `instanceAdminProcedure`), its session teardown on ban and delete, and the
 * audit hooks in `packages/auth/src/admin-hooks.ts` — which fire for these
 * calls exactly as they do for a request made straight to `/api/auth/admin/*`.
 *
 * The handlers here add what the plugin has no concept of: the instance's
 * refusal to lose its last admin, and the mail-driven password reset.
 */
const forwarded = (headers: Headers) => ({ headers });

export const adminUserActionRouter = {
  setRole: instanceAdminProcedure
    .route({ method: "POST", path: "/admin/users/{userId}/role", tags: TAGS, summary: "Set role" })
    .input(SetInstanceRoleInputSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      if (input.role !== "admin") await assertNotLastAdmin(context.db, input.userId);
      await auth.api.setRole({ ...forwarded(context.headers), body: input });
      return { success: true as const };
    }),

  ban: instanceAdminProcedure
    .route({ method: "POST", path: "/admin/users/{userId}/ban", tags: TAGS, summary: "Ban" })
    .input(BanUserInputSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      await assertNotLastAdmin(context.db, input.userId);
      await auth.api.banUser({
        ...forwarded(context.headers),
        body: {
          userId: input.userId,
          banReason: input.reason,
          ...(input.expiresInDays
            ? { banExpiresIn: input.expiresInDays * SECONDS_PER_DAY }
            : /* permanent until lifted */ {}),
        },
      });
      return { success: true as const };
    }),

  unban: instanceAdminProcedure
    .route({ method: "POST", path: "/admin/users/{userId}/unban", tags: TAGS, summary: "Unban" })
    .input(AdminUserRefSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      await auth.api.unbanUser({ ...forwarded(context.headers), body: { userId: input.userId } });
      return { success: true as const };
    }),

  remove: instanceAdminProcedure
    .route({ method: "DELETE", path: "/admin/users/{userId}", tags: TAGS, summary: "Delete" })
    .input(AdminUserRefSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      await assertNotLastAdmin(context.db, input.userId);
      await auth.api.removeUser({ ...forwarded(context.headers), body: { userId: input.userId } });
      return { success: true as const };
    }),

  /**
   * Sends the ordinary "forgot password" mail instead of setting a password the
   * admin would then have to transmit. The admin never learns the credential,
   * and the reset still requires access to the target's inbox.
   */
  sendPasswordReset: instanceAdminProcedure
    .route({
      method: "POST",
      path: "/admin/users/{userId}/password-reset",
      tags: TAGS,
      summary: "Send a password-reset mail",
    })
    .input(AdminUserRefSchema)
    .output(AdminActionResultSchema)
    .handler(async ({ input, context }) => {
      const rows = await context.db
        .select({ id: user.id, email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1);
      const target = rows[0];
      if (!target) throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden" });

      await auth.api.requestPasswordReset({
        body: {
          email: target.email,
          redirectTo: new URL("/auth/reset-password", env.CORS_ORIGIN).toString(),
        },
      });

      // Not an `/admin/*` endpoint, so the hooks in packages/auth do not see it;
      // this is the one admin action that has to log itself.
      await recordAdminAudit(context.db, {
        action: "user.password_reset_requested",
        actor: {
          id: context.session.user.id,
          email: context.session.user.email,
          name: context.session.user.name,
        },
        target,
      });
      return { success: true as const };
    }),
};
