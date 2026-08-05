import { boolean, text, timestamp } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { timestamps } from "../_helpers";
import { organization } from "../auth";

/**
 * Org-scoped security and governance policy. One row per organization, and the
 * absence of a row *is* "everything at its default" — the same "no row =
 * inherit" invariant `organization_digest_setting` relies on, so an org behaves
 * identically before and after an admin first opens the settings page.
 *
 * Deliberately one table for all policies rather than one table per policy:
 * session lifetime, password rules and allowed e-mail domains are queued behind
 * this one, and they are read together on the same request path. A table each
 * would turn a single cached lookup into a fan-out of joins.
 */
export const organizationSetting = wikiSchema.table("organization_setting", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),

  /** Members must hold a second factor to use the API at all. */
  twoFactorRequired: boolean("two_factor_required").notNull().default(false),

  /**
   * Until this instant a non-compliant member still gets through, warned rather
   * than blocked. Null means the requirement bites immediately — correct for an
   * org that turns it on before inviting anyone, hostile for one that does not,
   * which is why the settings UI defaults to a dated grace period instead.
   */
  twoFactorGraceUntil: timestamp("two_factor_grace_until", { withTimezone: true }),

  /**
   * Whether the requirement also covers accounts that sign in through an
   * enterprise IdP. Off by default: those users already passed their provider's
   * own second factor, and forcing a local TOTP on top is the usual reason an
   * organization leaves the whole policy switched off.
   */
  twoFactorRequireForSso: boolean("two_factor_require_for_sso").notNull().default(false),

  ...timestamps,
});
