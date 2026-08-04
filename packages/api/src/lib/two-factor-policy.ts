import { ORPCError } from "@orpc/server";
import { eq, exists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import type { Database } from "@nilovon-wiki/db";
import { account, member, passkey, ssoProvider, user } from "@nilovon-wiki/db/schema/index";

import { loadOrganizationSettings, type OrganizationSettings } from "./organization-settings";

/**
 * What we know about one account's second factor. Global to the user, not to
 * the organization — the same person carries the same factors everywhere.
 */
export type SecondFactorFacts = {
  /** TOTP is set up, or at least one passkey is registered. */
  hasSecondFactor: boolean;
  /** Signs in through an enterprise IdP, which supplies its own second factor. */
  isSsoAccount: boolean;
};

export type TwoFactorPolicyStatus =
  /** Nothing to do: not required, exempt, or already compliant. */
  | "ok"
  /** Required and unmet, but the grace period is still running. Warn, allow. */
  | "grace"
  /** Required, unmet, grace over. Refuse. */
  | "blocked";

export type TwoFactorPolicyState = SecondFactorFacts & {
  status: TwoFactorPolicyStatus;
  required: boolean;
  graceUntil: Date | null;
  /** True when only the SSO exemption is keeping this user out of `blocked`. */
  exemptAsSso: boolean;
};

/** A member as the admin screen lists them, so the count is explainable. */
export type MemberCompliance = SecondFactorFacts & {
  userId: string;
  name: string;
  email: string;
};

// Built through the query builder rather than as a raw `sql` template: raw
// templates render column references unqualified, which makes `user_id` and
// `provider_id` ambiguous the moment the subquery joins a second table.
const qb = new QueryBuilder();
const one = sql`1`;

/**
 * A registered passkey satisfies the requirement. It is phishing-resistant in a
 * way TOTP is not, so refusing it would push users towards the weaker factor.
 */
const hasPasskeySql = sql<boolean>`${exists(
  qb.select({ one }).from(passkey).where(eq(passkey.userId, user.id)),
)}`;

/**
 * An SSO account is one whose `account.provider_id` names a registered
 * `sso_provider` — that is how the SSO plugin links the two. Matching on the
 * provider row rather than on a list of provider ids means an organization
 * onboarding a new IdP does not need this check updated.
 */
const isSsoSql = sql<boolean>`${exists(
  qb
    .select({ one })
    .from(account)
    .innerJoin(ssoProvider, eq(ssoProvider.providerId, account.providerId))
    .where(eq(account.userId, user.id)),
)}`;

/**
 * Cached second-factor facts, but only ever *used* when they say the caller is
 * not blocked under the policy in force (see `readSecondFactorFacts`).
 *
 * That asymmetry is the whole design. A stale "has no second factor" would keep
 * someone locked out for the length of the TTL immediately after they finished
 * setting one up — the worst possible moment. Since the blocked path always
 * re-reads, enrolment takes effect on the very next request, while compliant
 * and exempt callers — everyone else, on every request — are served from
 * memory.
 */
const CACHE_TTL_MS = 30_000;

const factsCache = new Map<string, { value: SecondFactorFacts; expiresAt: number }>();

/** Both facts in one round trip; the middleware needs them together or not at all. */
export async function loadSecondFactorFacts(
  db: Database,
  userId: string,
): Promise<SecondFactorFacts> {
  const [row] = await db
    .select({
      twoFactorEnabled: user.twoFactorEnabled,
      hasPasskey: hasPasskeySql,
      isSso: isSsoSql,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return {
    hasSecondFactor: Boolean(row?.twoFactorEnabled) || Boolean(row?.hasPasskey),
    isSsoAccount: Boolean(row?.isSso),
  };
}

/** Whether `settings` would refuse a caller with these facts, grace aside. */
function wouldBlock(settings: OrganizationSettings, facts: SecondFactorFacts): boolean {
  if (!settings.twoFactorRequired) return false;
  if (facts.hasSecondFactor) return false;
  return settings.twoFactorRequireForSso || !facts.isSsoAccount;
}

async function readSecondFactorFacts(
  db: Database,
  userId: string,
  settings: OrganizationSettings,
): Promise<SecondFactorFacts> {
  const cached = factsCache.get(userId);
  if (cached && cached.expiresAt > Date.now() && !wouldBlock(settings, cached.value)) {
    return cached.value;
  }

  const facts = await loadSecondFactorFacts(db, userId);
  factsCache.set(userId, { value: facts, expiresAt: Date.now() + CACHE_TTL_MS });
  return facts;
}

/** Drops one user's cached facts, or the whole cache when omitted. */
export function invalidateSecondFactorFacts(userId?: string): void {
  if (userId === undefined) {
    factsCache.clear();
    return;
  }
  factsCache.delete(userId);
}

/**
 * The policy verdict for one member of one organization. `now` is injected so
 * the grace boundary is testable without freezing the clock.
 */
export async function evaluateTwoFactorPolicy(
  db: Database,
  input: { userId: string; organizationId: string; now?: Date },
): Promise<TwoFactorPolicyState> {
  const settings = await loadOrganizationSettings(db, input.organizationId);

  const base = {
    required: settings.twoFactorRequired,
    graceUntil: settings.twoFactorGraceUntil,
  };

  // Nothing to look up when the organization has no requirement — the default,
  // and the case that must stay free.
  if (!settings.twoFactorRequired) {
    return {
      ...base,
      status: "ok",
      hasSecondFactor: false,
      isSsoAccount: false,
      exemptAsSso: false,
    };
  }

  const facts = await readSecondFactorFacts(db, input.userId, settings);
  const exemptAsSso = facts.isSsoAccount && !settings.twoFactorRequireForSso;

  if (facts.hasSecondFactor || exemptAsSso) {
    return { ...base, ...facts, status: "ok", exemptAsSso };
  }

  const now = input.now ?? new Date();
  const inGrace = settings.twoFactorGraceUntil !== null && settings.twoFactorGraceUntil > now;
  return { ...base, ...facts, status: inGrace ? "grace" : "blocked", exemptAsSso };
}

/**
 * The oRPC error code the web client keys its two-factor setup screen off. It
 * is a code of its own rather than a plain `FORBIDDEN` so the client can tell
 * "you may not do this" apart from "you may not do *anything* yet" without
 * pattern-matching on a message.
 */
export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";

/**
 * Throws `TWO_FACTOR_REQUIRED` when this caller owes their organization a
 * second factor. The oRPC middleware is the main caller, but the routes that
 * serve bytes rather than JSON — attachment uploads, Space exports — sit
 * outside the oRPC chain and have to ask for themselves. Without that, "may not
 * read any data" would stop at the JSON API and leave every attachment and a
 * whole-space export reachable.
 */
export async function assertTwoFactorCompliance(
  db: Database,
  session: { user?: { id: string }; session?: { activeOrganizationId?: string | null } } | null,
): Promise<void> {
  const userId = session?.user?.id;
  const organizationId = session?.session?.activeOrganizationId;
  // No session or no active organization: nothing to enforce against. The
  // former is already refused upstream, the latter is the pre-onboarding state.
  if (!userId || !organizationId) return;

  const policy = await evaluateTwoFactorPolicy(db, { userId, organizationId });
  if (policy.status !== "blocked") return;

  throw new ORPCError(TWO_FACTOR_REQUIRED, {
    // `status` is pinned because an unknown code would otherwise be served as
    // a 500, and the callers below map 403 to a refusal.
    status: 403,
    message: "Diese Organisation verlangt eine Zwei-Faktor-Authentifizierung.",
    data: { graceUntil: policy.graceUntil },
  });
}

/**
 * Every member of the organization with their factor status. The admin screen
 * turns this into "N of M members would be locked out", which is the number
 * that decides whether the switch gets flipped at all.
 */
export async function listMemberCompliance(
  db: Database,
  organizationId: string,
): Promise<MemberCompliance[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      hasPasskey: hasPasskeySql,
      isSso: isSsoSql,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    hasSecondFactor: Boolean(row.twoFactorEnabled) || Boolean(row.hasPasskey),
    isSsoAccount: Boolean(row.isSso),
  }));
}

/** The members a requirement with these settings would eventually lock out. */
export function affectedMembers(
  members: MemberCompliance[],
  settings: Pick<OrganizationSettings, "twoFactorRequireForSso">,
): MemberCompliance[] {
  return members.filter(
    (entry) => !entry.hasSecondFactor && (settings.twoFactorRequireForSso || !entry.isSsoAccount),
  );
}
