import { and, isNull, type SQL } from "drizzle-orm";

import { page, space } from "@nilovon-wiki/db/schema/index";

/**
 * The "not in the trash" predicates, in one place.
 *
 * Every cross-space reader — search, backlinks, favorites, subscriptions, tag
 * listings, the digest collector, the dashboard counters — has to apply the same
 * rule, and the failure mode of forgetting is the worst one there is: a page the
 * user deleted keeps showing up. Naming the predicate makes the omission
 * greppable instead of invisible.
 *
 * Two predicates rather than one because a page can be hidden by its own
 * deletion *or* by its space's, and not every query has both tables in scope.
 */

/** The page itself is not trashed. Combine with `spaceNotTrashed` when joined. */
export const pageNotTrashed = (): SQL | undefined => isNull(page.deletedAt);

/** The space is not trashed — which hides everything inside it. */
export const spaceNotTrashed = (): SQL | undefined => isNull(space.deletedAt);

/**
 * A page is live: neither it nor its space is in the trash. Requires both tables
 * in the query (a join on `page.spaceId = space.id`).
 */
export const pageLive = (): SQL | undefined => and(pageNotTrashed(), spaceNotTrashed());
