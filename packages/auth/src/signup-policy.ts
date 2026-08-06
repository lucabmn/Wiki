import type { Database } from "@nilovon-wiki/db";
import { invitation } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth/types";
import { and, eq, gt, sql } from "drizzle-orm";
import { isInitialAdminEmail } from "./instance-admin";

/**
 * Who may open an account on this instance.
 *
 * Enforced on Better Auth's own `/sign-up/email` endpoint rather than in a
 * `user.create` database hook, because that hook also fires for the two paths
 * that must stay open: SSO provisioning and SCIM directory sync. Both are
 * configured by an administrator, and that configuration *is* the invitation —
 * subjecting them to the registration policy would break enterprise sign-in on
 * a wiki whose operator merely wanted to close the public form.
 *
 * The knobs themselves live in `packages/env/src/server.ts`:
 * `SIGNUP_MODE`, `SIGNUP_ALLOWED_EMAIL_DOMAINS`, `REQUIRE_EMAIL_VERIFICATION`.
 */

export type SignupMode = "open" | "invite" | "closed";

/** The endpoint the policy guards. Sign-*in* is deliberately untouched. */
const SIGN_UP_PATH = "/sign-up/email";

/**
 * Parses `SIGNUP_ALLOWED_EMAIL_DOMAINS` into lower-cased domains.
 *
 * Accepts commas or whitespace as separators and tolerates a leading `@` or
 * `.`, because operators write the list all three ways and a silently ignored
 * entry would read as "the allowlist let them through".
 */
export function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^[@.]+/, ""),
    )
    .filter(Boolean);
}

/** The part after the last `@`, lower-cased; empty for anything that is not an address. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/** True when `email` is covered by the allowlist. An empty list allows everything. */
export function isDomainAllowed(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.includes(emailDomain(email));
}

/**
 * True when `email` has an invitation that is still open.
 *
 * Both conditions matter: a revoked or already-accepted invitation must not
 * keep the door open, and an expired one is exactly the case the expiry was
 * added for.
 */
export async function hasOpenInvitation(db: Database, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Why a registration was refused, in the language the rest of the app speaks. */
const REFUSALS = {
  closed:
    "Auf dieser Instanz ist die Registrierung deaktiviert. Bitte wende dich an die Administration.",
  invite:
    "Für diese E-Mail-Adresse liegt keine gültige Einladung vor. Bitte wende dich an die Administration.",
  domain: "Für diese E-Mail-Domain ist die Registrierung nicht freigegeben.",
} as const;

/**
 * Decides a single registration attempt.
 *
 * Split out from the plugin so it can be tested without standing up Better
 * Auth. Returns `null` when the address may register, or the reason to refuse.
 */
export async function refuseSignupReason(db: Database, email: string): Promise<string | null> {
  // The bootstrap escape hatch. Without it a fresh instance configured as
  // `closed` has no path to its first account — and therefore no admin who
  // could reopen registration.
  if (isInitialAdminEmail(email)) return null;

  const allowed = parseAllowedDomains(env.SIGNUP_ALLOWED_EMAIL_DOMAINS);
  if (!isDomainAllowed(email, allowed)) return REFUSALS.domain;

  const mode = env.SIGNUP_MODE as SignupMode;
  if (mode === "closed") return REFUSALS.closed;
  if (mode === "invite" && !(await hasOpenInvitation(db, email))) return REFUSALS.invite;

  return null;
}

/**
 * Plugin enforcing the registration policy.
 *
 * `db` is the handle `createAuth` already built, so the invitation lookup
 * shares its pool instead of opening a second one.
 */
export function signupPolicyPlugin(db: Database) {
  return {
    id: "nilovon-signup-policy",
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === SIGN_UP_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            // A missing or malformed address is Better Auth's own validation to
            // reject; refusing it here would answer with the wrong error.
            if (typeof email !== "string" || !email) return;

            const reason = await refuseSignupReason(db, email);
            if (reason) throw new APIError("FORBIDDEN", { message: reason });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
