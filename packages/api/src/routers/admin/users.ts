import { ORPCError } from "@orpc/server";
import {
  aliasedTable,
  and,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  ilike,
  max,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import {
  account,
  member,
  organization,
  passkey,
  session,
  twoFactor,
  user,
} from "@nilovon-wiki/db/schema/index";
import { splitInstanceRoles } from "@nilovon-wiki/auth/instance-admin";

import { instanceAdminProcedure, nowUtc } from "../../lib/instance-admin";
import { firstRow } from "../../lib/rows";
import {
  AdminUserDetailSchema,
  AdminUserRefSchema,
  AdminUserSummarySchema,
  ListAdminUsersInputSchema,
} from "../../schemas/admin";

const TAGS = ["Admin"];

/**
 * Matches the comma-separated role list Better Auth stores, so `admin` is found
 * inside `owner,admin` too — a plain `= 'admin'` silently misses those accounts.
 */
const HAS_ADMIN_ROLE = sql`string_to_array(coalesce(${user.role}, ''), ',') && array['admin']`;

/**
 * A second alias on `session`: "when were they last seen" has to look at every
 * session row, "how many sessions are live" only at unexpired ones, and both
 * are asked in the same query.
 */
const liveSession = aliasedTable(session, "live_session");

const userColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
  emailVerified: user.emailVerified,
  role: user.role,
  banned: user.banned,
  banReason: user.banReason,
  banExpires: user.banExpires,
  createdAt: user.createdAt,
  // `countDistinct`, not `count`: the joins below form a cross product — three
  // sessions × two memberships is six rows — and a plain count reports six of
  // each. Correlated subqueries are not an option either: Drizzle renders a
  // column inside a `sql` selection *without* its table prefix, so the outer
  // reference would silently bind to the subquery's own table.
  organizationCount: countDistinct(member.id),
  activeSessionCount: countDistinct(liveSession.id),
  lastSeenAt: max(session.createdAt),
};

/** Adds the aggregate joins shared by the list and the detail query. */
function selectUsers(db: Database) {
  return (
    db
      .select(userColumns)
      .from(user)
      .leftJoin(member, eq(member.userId, user.id))
      .leftJoin(session, eq(session.userId, user.id))
      .leftJoin(
        liveSession,
        and(eq(liveSession.userId, user.id), gt(liveSession.expiresAt, nowUtc)),
      )
      // Grouping by the primary key covers every other selected user column.
      .groupBy(user.id)
  );
}

/**
 * `user.role` is a comma-separated list and `user.banned` is nullable in Better
 * Auth's schema; the API surface exposes a split array and a plain boolean.
 */
function toSummary<T extends { role: string | null; banned: boolean | null }>({
  role,
  banned,
  ...rest
}: T) {
  return { ...rest, roles: splitInstanceRoles(role), banned: banned ?? false };
}

export const adminUserRouter = {
  list: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/users",
      tags: TAGS,
      summary: "Every account on this instance",
    })
    .input(ListAdminUsersInputSchema)
    .output(z.object({ items: z.array(AdminUserSummarySchema), total: z.number().int() }))
    .handler(async ({ input, context }) => {
      const term = input.query?.trim();
      const where = and(
        term ? or(ilike(user.name, `%${term}%`), ilike(user.email, `%${term}%`)) : undefined,
        input.filter === "banned" ? eq(user.banned, true) : undefined,
        input.filter === "admins" ? HAS_ADMIN_ROLE : undefined,
      );

      const [rows, total] = await Promise.all([
        selectUsers(context.db)
          .where(where)
          .orderBy(desc(user.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        context.db.select({ n: count() }).from(user).where(where),
      ]);

      return { items: rows.map(toSummary), total: firstRow(total).n };
    }),

  get: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/users/{userId}",
      tags: TAGS,
      summary: "One account: memberships, sign-in methods, ban state",
    })
    .input(AdminUserRefSchema)
    .output(AdminUserDetailSchema)
    .handler(async ({ input, context }) => {
      const found = await selectUsers(context.db).where(eq(user.id, input.userId)).limit(1);
      const row = found[0];
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden" });

      const [memberships, passkeys, secondFactors, accounts] = await Promise.all([
        context.db
          .select({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            roles: member.role,
            joinedAt: member.createdAt,
          })
          .from(member)
          .innerJoin(organization, eq(member.organizationId, organization.id))
          .where(eq(member.userId, input.userId))
          .orderBy(organization.name),
        context.db.select({ n: count() }).from(passkey).where(eq(passkey.userId, input.userId)),
        context.db.select({ n: count() }).from(twoFactor).where(eq(twoFactor.userId, input.userId)),
        context.db
          .select({ providerId: account.providerId })
          .from(account)
          .where(eq(account.userId, input.userId)),
      ]);

      return {
        ...toSummary(row),
        // `user.twoFactorEnabled` is a cached flag; the row in `twoFactor` is
        // the fact. A support case turns on which of the two is stale.
        twoFactorEnabled: firstRow(secondFactors).n > 0,
        passkeyCount: firstRow(passkeys).n,
        providers: [...new Set(accounts.map((a) => a.providerId))].sort(),
        organizations: memberships.map(({ roles, ...org }) => ({
          ...org,
          roles: splitInstanceRoles(roles),
        })),
      };
    }),
};

/** How many accounts still carry an instance-admin role. */
export async function countInstanceAdmins(db: Database): Promise<number> {
  const rows = await db.select({ n: count() }).from(user).where(HAS_ADMIN_ROLE);
  return firstRow(rows).n;
}

/**
 * Refuses to strip the console's last key holder.
 *
 * Better Auth happily bans, demotes or deletes the final admin — it has no
 * notion of "instance". Locking everyone out of the console is recoverable only
 * by editing the database by hand, so it is worth one query.
 */
export async function assertNotLastAdmin(db: Database, userId: string): Promise<void> {
  const target = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!splitInstanceRoles(target[0]?.role).includes("admin")) return;
  if ((await countInstanceAdmins(db)) <= 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Das ist der letzte Instanz-Administrator — ernenne zuerst einen weiteren.",
    });
  }
}
