import type { Database } from "@nilovon-wiki/db";
import { session as sessionTable, user as userTable } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth/types";
import { eq } from "drizzle-orm";

import {
  mirrorImpersonationActivity,
  recordAdminAudit,
  type AdminAuditAction,
  type AuditIdentity,
} from "./admin-audit";
import { invalidateCachedSessions } from "./session-revocation";

/**
 * Auditing lives on Better Auth's own endpoints rather than in the API router:
 * an instance admin holds a session that can reach `/api/auth/admin/*` with
 * curl. This is the only placement where "it happened" and "it was recorded"
 * cannot come apart.
 */

/** The hook context Better Auth hands to a middleware — it exposes no name for it. */
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Endpoints whose successful response alone identifies the target. */
const AUDITED_BY_RESPONSE: Record<string, AdminAuditAction> = {
  "/admin/create-user": "user.created",
  "/admin/ban-user": "user.banned",
  "/admin/unban-user": "user.unbanned",
  "/admin/set-role": "user.role_changed",
  "/admin/impersonate-user": "impersonation.started",
};

/** Endpoints whose target is `body.userId` and still exists afterwards. */
const AUDITED_BY_BODY: Record<string, AdminAuditAction> = {
  "/admin/set-user-password": "user.password_set",
  "/admin/revoke-user-sessions": "session.revoked_all",
};

/** Endpoints whose target can only be read *before* the handler destroys it. */
const AUDITED_BY_PRE_STATE: Record<string, AdminAuditAction> = {
  "/admin/remove-user": "user.deleted",
  "/admin/revoke-user-session": "session.revoked",
  "/admin/stop-impersonating": "impersonation.ended",
};

/** Targets whose cached session cookies must stop validating immediately. */
const INVALIDATES_SESSIONS = new Set([
  "/admin/ban-user",
  "/admin/set-role",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
]);

type PreState = {
  actor: AuditIdentity | null;
  target: AuditIdentity | null;
  metadata?: Record<string, unknown>;
};

/**
 * Hand-off between the `before` and `after` hook of one request.
 *
 * Writing the row from the `before` hook would log deletions a failing handler
 * never performed, so the pre-state is parked here and committed only once the
 * handler returned a payload. Keyed by path plus target, swept by TTL so an
 * aborted request leaks nothing.
 */
const PRE_STATE_TTL_MS = 30_000;
const preStates = new Map<string, { value: PreState; expiresAt: number }>();

function stashPreState(key: string, value: PreState): void {
  const now = Date.now();
  for (const [existing, entry] of preStates) {
    if (entry.expiresAt <= now) preStates.delete(existing);
  }
  preStates.set(key, { value, expiresAt: now + PRE_STATE_TTL_MS });
}

function takePreState(key: string): PreState | null {
  const entry = preStates.get(key);
  if (!entry) return null;
  preStates.delete(key);
  return entry.expiresAt > Date.now() ? entry.value : null;
}

async function loadIdentity(db: Database, userId: string): Promise<AuditIdentity | null> {
  const rows = await db
    .select({ id: userTable.id, email: userTable.email, name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

function identityOf(value: unknown): AuditIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { id?: unknown; email?: unknown; name?: unknown };
  if (typeof candidate.id !== "string") return null;
  return {
    id: candidate.id,
    email: typeof candidate.email === "string" ? candidate.email : null,
    name: typeof candidate.name === "string" ? candidate.name : null,
  };
}

/** The real human behind the request, even on endpoints that set no session themselves. */
async function resolveActor(ctx: HookContext): Promise<AuditIdentity | null> {
  const active = ctx.context.session ?? (await getSessionFromCtx(ctx));
  return identityOf(active?.user);
}

/** The handler's successful payload, or null when it threw. */
function endpointResponse(ctx: HookContext): Record<string, unknown> | null {
  const returned: unknown = ctx.context.returned;
  if (!returned || returned instanceof Response || returned instanceof Error) return null;
  return typeof returned === "object" ? (returned as Record<string, unknown>) : null;
}

function bodyOf(ctx: HookContext): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

/** Captures what the handler is about to destroy, so the audit row can still name it. */
async function capturePreState(db: Database, ctx: HookContext, path: string): Promise<void> {
  const body = bodyOf(ctx);

  if (path === "/admin/remove-user") {
    const userId = body.userId;
    if (typeof userId !== "string") return;
    stashPreState(`${path}:${userId}`, {
      actor: await resolveActor(ctx),
      target: await loadIdentity(db, userId),
    });
    return;
  }

  if (path === "/admin/revoke-user-session") {
    const token = body.sessionToken;
    if (typeof token !== "string") return;
    const rows = await db
      .select({ userId: sessionTable.userId })
      .from(sessionTable)
      .where(eq(sessionTable.token, token))
      .limit(1);
    const owner = rows[0]?.userId;
    stashPreState(`${path}:${token}`, {
      actor: await resolveActor(ctx),
      target: owner ? await loadIdentity(db, owner) : null,
    });
    return;
  }

  // stop-impersonating: the session naming both identities is deleted by the
  // handler, and its response only carries the admin's restored session.
  const active = await getSessionFromCtx(ctx);
  const adminId = active?.session.impersonatedBy;
  if (!active || typeof adminId !== "string") return;
  stashPreState(`${path}:${adminId}`, {
    actor: await loadIdentity(db, adminId),
    target: identityOf(active.user),
    metadata: { impersonationStartedAt: active.session.createdAt ?? null },
  });
}

/** Reads back the pre-state under the same key the `before` hook stored it. */
function matchPreState(
  ctx: HookContext,
  path: string,
  response: Record<string, unknown>,
): PreState | null {
  const body = bodyOf(ctx);
  if (path === "/admin/remove-user") return takePreState(`${path}:${String(body.userId)}`);
  if (path === "/admin/revoke-user-session") {
    return takePreState(`${path}:${String(body.sessionToken)}`);
  }
  const adminId = identityOf(response.user)?.id;
  return adminId ? takePreState(`${path}:${adminId}`) : null;
}

/** Event-specific detail worth keeping beyond who did what to whom. */
function auditMetadata(
  path: string,
  ctx: HookContext,
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const body = bodyOf(ctx);
  switch (path) {
    case "/admin/ban-user":
      return { banReason: body.banReason ?? null, banExpiresIn: body.banExpiresIn ?? null };
    case "/admin/set-role":
      return { role: body.role ?? null };
    case "/admin/impersonate-user":
      return { expiresAt: (response.session as { expiresAt?: unknown } | undefined)?.expiresAt };
    default:
      return undefined;
  }
}

/**
 * Plugin that audits every instance-admin action and enforces the impersonation
 * kill-switch. Registered after `admin()` so it observes that plugin's
 * endpoints; `db` is the handle `createAuth` already built, so audit writes
 * share its pool.
 */
export function adminAuditPlugin(db: Database) {
  return {
    id: "nilovon-admin-audit",
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/admin/impersonate-user",
          handler: createAuthMiddleware(async () => {
            // Enforced server-side, not merely hidden: an operator who turns
            // impersonation off needs the capability to be absent.
            if (!env.IMPERSONATION_ENABLED) {
              throw new APIError("FORBIDDEN", {
                message: "Impersonation ist auf dieser Instanz deaktiviert",
              });
            }
          }),
        },
        {
          matcher: (ctx: { path?: string }) => !!ctx.path && ctx.path in AUDITED_BY_PRE_STATE,
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path) await capturePreState(db, ctx, ctx.path);
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) =>
            !!ctx.path &&
            (ctx.path in AUDITED_BY_RESPONSE ||
              ctx.path in AUDITED_BY_BODY ||
              ctx.path in AUDITED_BY_PRE_STATE),
          handler: createAuthMiddleware(async (ctx) => {
            const path = ctx.path;
            if (!path) return;
            const response = endpointResponse(ctx);
            // No payload means the handler threw — nothing happened, nothing to log.
            if (!response) return;

            let action: AdminAuditAction;
            let actor = await resolveActor(ctx);
            let target: AuditIdentity | null;
            let metadata = auditMetadata(path, ctx, response);

            if (path in AUDITED_BY_RESPONSE) {
              action = AUDITED_BY_RESPONSE[path]!;
              target = identityOf(response.user);
            } else if (path in AUDITED_BY_BODY) {
              action = AUDITED_BY_BODY[path]!;
              const userId = bodyOf(ctx).userId;
              target = typeof userId === "string" ? await loadIdentity(db, userId) : null;
            } else {
              action = AUDITED_BY_PRE_STATE[path]!;
              const pre = matchPreState(ctx, path, response);
              target = pre?.target ?? null;
              actor = pre?.actor ?? actor;
              metadata = pre?.metadata;
            }

            if (!target) return;
            if (INVALIDATES_SESSIONS.has(path)) invalidateCachedSessions(target.id);

            await recordAdminAudit(db, { action, actor, target, metadata });

            if (actor && (action === "impersonation.started" || action === "impersonation.ended")) {
              await mirrorImpersonationActivity(db, { action, target, admin: actor, metadata });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
