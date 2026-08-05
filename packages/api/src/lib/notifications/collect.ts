import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  favorite,
  member,
  page,
  pageSubscription,
  space,
  user,
} from "@nilovon-wiki/db/schema/index";

import type { ActivityAction } from "../activity";
import {
  filterReadablePagesAs,
  isOrgManagerAs,
  loadReadableSpacesAs,
  loadSpaceMembershipIds,
  loadSpaceRoleAs,
  type Principal,
  type SpaceAccessInput,
} from "../access";
import {
  actionsForCategories,
  categoryForAction,
  type DigestCategory,
  type DigestPreferences,
} from "./settings";

/**
 * How many events one digest reports at most. A wiki-wide import can write
 * thousands of activity rows in a minute; a mail listing all of them is useless
 * and expensive. The newest are kept and the mail says how many were dropped.
 */
export const DIGEST_MAX_ENTRIES = 200;

export type DigestEntry = {
  id: string;
  action: ActivityAction;
  category: DigestCategory;
  createdAt: Date;
  actorName: string | null;
  spaceId: string | null;
  spaceName: string | null;
  pageId: string | null;
  /** The page/space title, preferring the denormalized copy in `metadata`
   *  because the referenced row may since have been renamed or deleted. */
  title: string | null;
};

export type DigestContent = {
  entries: DigestEntry[];
  /** Events that matched but did not fit under `DIGEST_MAX_ENTRIES`. */
  truncated: number;
};

/** Reads `metadata.title` / `metadata.name` off an activity row, if present. */
function titleFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ["title", "name"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * The events one recipient's next digest should report, for the window
 * `(from, to]`.
 *
 * Authorization is re-evaluated here rather than trusted from when the event
 * was written: access changes, and a digest must never surface a space or page
 * the recipient cannot open *now*. The rules are the same ones the in-app feed
 * applies (`activity.list`), resolved through the session-free `*As` helpers.
 */
export async function collectDigest(
  db: Database,
  input: {
    userId: string;
    organizationId: string;
    preferences: DigestPreferences;
    from: Date;
    to: Date;
  },
): Promise<DigestContent> {
  const { userId, organizationId, preferences, from, to } = input;
  const actions = actionsForCategories(preferences.categories);
  if (actions.length === 0) return { entries: [], truncated: 0 };

  // Membership is the precondition every rule below assumes — `public` spaces
  // are readable by "any org member", so a principal naming an org they do not
  // belong to would sail straight through. Request paths establish this via the
  // session's active org, but this function is also reached from a background
  // job with no session, so it establishes it itself.
  const membership = await db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    columns: { id: true },
  });
  if (!membership) return { entries: [], truncated: 0 };

  const principal: Principal = { userId, organizationId };

  const rows = await db
    .select({
      id: activity.id,
      action: activity.action,
      metadata: activity.metadata,
      createdAt: activity.createdAt,
      spaceId: activity.spaceId,
      pageId: activity.pageId,
      actorName: user.name,
      spaceName: space.name,
      pageTitle: page.title,
      pageVisibility: page.visibility,
      pageCreatedBy: page.createdBy,
    })
    .from(activity)
    .leftJoin(user, eq(activity.actorId, user.id))
    .leftJoin(space, eq(activity.spaceId, space.id))
    .leftJoin(page, eq(activity.pageId, page.id))
    .where(
      and(
        eq(activity.organizationId, organizationId),
        // Half-open window: `from` is the cursor of the last delivered digest,
        // so its own boundary event must not be reported twice.
        gt(activity.createdAt, from),
        lte(activity.createdAt, to),
        inArray(activity.action, actions),
        // `ne` alone would also drop system events (actorId null), which nobody
        // authored and everybody should see.
        preferences.includeOwnActivity
          ? undefined
          : or(isNull(activity.actorId), ne(activity.actorId, userId)),
        // Work that has never been published is not digest material. The reader
        // APIs already redact a draft's body for everyone (`redactDraftBody`),
        // and mailing the whole space about a half-written page is worse than
        // showing it in a tree they chose to open. `publishedAt` is the durable
        // signal — archiving changes `status` but not this. Authors still hear
        // about their own drafts, so nothing they can act on goes missing.
        or(isNull(activity.pageId), isNotNull(page.publishedAt), eq(page.createdBy, userId)),
        // Nobody wants a mail because someone fixed a typo in the meeting-notes
        // template. Templates are hidden from every reader view; the digest is
        // no exception.
        or(isNull(activity.pageId), eq(page.isTemplate, false)),
        // Nothing about a page in the trash, not even the deletion itself. The
        // trash is a staging area: while a page sits in it the deletion is still
        // reversible, and mailing "Ada deleted X" for something that may be back
        // tomorrow trains people to ignore the digest. The final removal is
        // announced as `page.purged`, which carries no page id and so survives
        // this filter.
        or(isNull(activity.pageId), isNull(page.deletedAt)),
      ),
    )
    .orderBy(desc(activity.createdAt))
    // One over the cap, so "were there more?" needs no second count query.
    .limit(DIGEST_MAX_ENTRIES + 1);

  if (rows.length === 0) return { entries: [], truncated: 0 };

  const readableSpaces = await loadReadableSpacesAs(db, principal, organizationId);
  const spaceById = new Map<string, SpaceAccessInput>(readableSpaces.map((row) => [row.id, row]));

  // Space-level read access. Rows whose space is already gone (the FK nulls on
  // delete) carry no ACL to check any more; keep only the unambiguously
  // space-scoped ones, exactly as the in-app feed does.
  let visible = rows.filter((row) =>
    row.spaceId ? spaceById.has(row.spaceId) : row.action.startsWith("space."),
  );

  visible = await applyScope(db, principal, preferences, visible);
  visible = await applyPageAcl(db, principal, organizationId, spaceById, visible);

  const capped = visible.slice(0, DIGEST_MAX_ENTRIES);
  const entries = capped.flatMap((row) => {
    const category = categoryForAction(row.action);
    // Unreachable while `actions` is derived from the categories, but an action
    // added to the enum and not yet mapped must be dropped, not crash the run.
    if (!category) return [];
    return [
      {
        id: row.id,
        action: row.action,
        category,
        createdAt: row.createdAt,
        actorName: row.actorName,
        spaceId: row.spaceId,
        spaceName: row.spaceName,
        pageId: row.pageId,
        title: titleFromMetadata(row.metadata) ?? row.pageTitle ?? row.spaceName,
      } satisfies DigestEntry,
    ];
  });

  return { entries, truncated: Math.max(0, visible.length - capped.length) };
}

type ScopedRow = {
  spaceId: string | null;
  pageId: string | null;
};

/** Narrows the feed to the slice of the org the recipient asked for. */
async function applyScope<T extends ScopedRow>(
  db: Database,
  principal: Principal,
  preferences: DigestPreferences,
  rows: T[],
): Promise<T[]> {
  if (preferences.scope === "organization") return rows;

  if (preferences.scope === "my_spaces") {
    const membership = await loadSpaceMembershipIds(db, principal);
    return rows.filter((row) => !!row.spaceId && membership.has(row.spaceId));
  }

  // "subscribed": watched pages and favorites. Space-level events carry no page
  // and therefore never match — which is the point of this scope.
  const [watched, favorited] = await Promise.all([
    db
      .select({ pageId: pageSubscription.pageId })
      .from(pageSubscription)
      .where(eq(pageSubscription.userId, principal.userId)),
    db
      .select({ pageId: favorite.pageId })
      .from(favorite)
      .where(eq(favorite.userId, principal.userId)),
  ]);
  const pageIds = new Set([...watched, ...favorited].map((row) => row.pageId));
  return rows.filter((row) => !!row.pageId && pageIds.has(row.pageId));
}

type PageAclRow = {
  spaceId: string | null;
  pageId: string | null;
  pageVisibility: "public" | "private" | "restricted" | null;
  pageCreatedBy: string | null;
  action: string;
};

/**
 * Drops rows about pages the recipient cannot open under a per-page override.
 * Space read access is already established for every row's space.
 */
async function applyPageAcl<T extends PageAclRow>(
  db: Database,
  principal: Principal,
  organizationId: string,
  spaceById: Map<string, SpaceAccessInput>,
  rows: T[],
): Promise<T[]> {
  const overridden = new Map<
    string,
    {
      id: string;
      spaceId: string;
      visibility: PageAclRow["pageVisibility"];
      createdBy: string | null;
    }
  >();
  for (const row of rows) {
    if (!row.pageId || !row.spaceId || row.pageVisibility === null) continue;
    overridden.set(row.pageId, {
      id: row.pageId,
      spaceId: row.spaceId,
      visibility: row.pageVisibility,
      createdBy: row.pageCreatedBy,
    });
  }
  // No page carries an override → every page inherits its space, which passed.
  if (overridden.size === 0) return rows;

  const manager = await isOrgManagerAs(db, principal.userId, organizationId);
  const readable = new Set<string>();
  const pages = [...overridden.values()];
  for (const spaceId of new Set(pages.map((page) => page.spaceId))) {
    const spaceRow = spaceById.get(spaceId);
    if (!spaceRow) continue;
    const spaceRole = await loadSpaceRoleAs(db, principal, spaceRow, manager);
    const allowed = await filterReadablePagesAs(
      db,
      principal,
      pages.filter((page) => page.spaceId === spaceId),
      spaceRole,
    );
    for (const page of allowed) readable.add(page.id);
  }

  return rows.filter(
    (row) => row.pageVisibility === null || !row.pageId || readable.has(row.pageId),
  );
}
