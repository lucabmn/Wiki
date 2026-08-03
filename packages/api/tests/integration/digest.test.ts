import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Typed to the real `deliverMail` signature so the assertions below can read
// the message that was handed to it without casting.
const { deliverMail, isMailConfigured } = vi.hoisted(() => ({
  deliverMail: vi.fn(
    async (_mail: {
      to: string;
      subject: string;
      text: string;
      html: string;
    }): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }),
  ),
  isMailConfigured: vi.fn(() => true),
}));
vi.mock("@nilovon-wiki/auth/mail", () => ({ deliverMail, isMailConfigured }));

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  digestDelivery,
  member,
  organization,
  organizationDigestSetting,
  page,
  pageMember,
  space,
  spaceMember,
  user,
  userDigestSetting,
} from "@nilovon-wiki/db/schema/index";

import { collectDigest } from "../../src/lib/notifications/collect";
import { rescheduleOrganizationDigests, runDueDigests } from "../../src/lib/notifications/run";
import { loadEffectiveDigestSettings } from "../../src/lib/notifications/settings";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
/**
 * The same handle, typed for the production signatures. pglite and
 * node-postgres differ only in the driver generic — every query here is
 * identical — so the suites cast once rather than threading a driver generic
 * through the whole data layer (`testContext` does the same for the routers).
 */
let dbAs: Database;

const now = new Date("2026-05-04T09:00:00Z"); // a Monday
const windowStart = new Date("2026-05-04T08:00:00Z");
const inWindow = new Date("2026-05-04T08:30:00Z");

/**
 * org oA: u1 reads only the public space, u2 is additionally a member of the
 * private one, u3 belongs to a different org entirely. Neither u1 nor u3 has a
 * `user_digest_setting` row — that absence is the point: they must still be
 * scheduled and must follow whatever the admin configured.
 */
beforeAll(async () => {
  db = await createTestDb();
  dbAs = db as unknown as Database;

  await db.insert(user).values([
    { id: "u1", name: "Ada", email: "ada@example.test", createdAt: now, updatedAt: now },
    { id: "u2", name: "Ben", email: "ben@example.test", createdAt: now, updatedAt: now },
    { id: "u3", name: "Cleo", email: "cleo@example.test", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "Acme", slug: "acme", createdAt: now },
    { id: "oB", name: "Other", slug: "other", createdAt: now },
  ]);
  await db.insert(member).values([
    { id: "m1", organizationId: "oA", userId: "u1", role: "member", createdAt: now },
    { id: "m2", organizationId: "oA", userId: "u2", role: "member", createdAt: now },
    { id: "m3", organizationId: "oB", userId: "u3", role: "member", createdAt: now },
  ]);
  await db.insert(space).values([
    {
      id: "sPub",
      organizationId: "oA",
      slug: "pub",
      name: "Handbuch",
      visibility: "public",
      createdBy: "u2",
    },
    {
      id: "sPriv",
      organizationId: "oA",
      slug: "priv",
      name: "Geheim",
      visibility: "private",
      createdBy: "u2",
    },
  ]);
  await db
    .insert(spaceMember)
    .values([{ id: "sm1", spaceId: "sPriv", subject: "user", userId: "u2", role: "editor" }]);
  // `publishedAt` matters: a digest never reports a page that has not crossed
  // the publication boundary (see the draft cases at the bottom).
  await db.insert(page).values([
    {
      id: "pPub",
      spaceId: "sPub",
      slug: "start",
      title: "Startseite",
      status: "published",
      publishedAt: now,
      createdBy: "u2",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "pPriv",
      spaceId: "sPriv",
      slug: "plan",
      title: "Geheimplan",
      status: "published",
      publishedAt: now,
      createdBy: "u2",
      createdAt: now,
      updatedAt: now,
    },
    // Lives in the public space but carries its own ACL: only u2 is on it.
    {
      id: "pLocked",
      spaceId: "sPub",
      slug: "gehalt",
      title: "Gehaltsbaender",
      status: "published",
      publishedAt: now,
      visibility: "private",
      createdBy: "u2",
      createdAt: now,
      updatedAt: now,
    },
    // Never published — authored by u2.
    {
      id: "pDraft",
      spaceId: "sPub",
      slug: "entwurf",
      title: "Unfertiger Entwurf",
      status: "draft",
      createdBy: "u2",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db
    .insert(pageMember)
    .values([{ id: "pm1", pageId: "pLocked", subject: "user", userId: "u2", role: "editor" }]);
});

afterAll(async () => {
  await db.$end();
});

beforeEach(async () => {
  deliverMail.mockClear();
  deliverMail.mockResolvedValue({ ok: true });
  isMailConfigured.mockReturnValue(true);
  await db.delete(activity);
  await db.delete(digestDelivery);
  await db.delete(userDigestSetting);
  await db.delete(organizationDigestSetting);
});

/** One activity row inside the test window. */
async function recordEvent(input: {
  id: string;
  action: "page.created" | "page.updated" | "comment.created";
  spaceId: string;
  pageId: string;
  actorId: string;
  title: string;
  createdAt?: Date;
}) {
  await db.insert(activity).values({
    id: input.id,
    organizationId: "oA",
    spaceId: input.spaceId,
    pageId: input.pageId,
    actorId: input.actorId,
    action: input.action,
    metadata: { title: input.title },
    createdAt: input.createdAt ?? inWindow,
  });
}

/** Makes a recipient due right now, with the window opening at `windowStart`. */
async function makeDue(userId: string) {
  await db
    .insert(digestDelivery)
    .values({
      userId,
      organizationId: "oA",
      cursorAt: windowStart,
      nextRunAt: new Date(now.getTime() - 1000),
    })
    .onConflictDoUpdate({
      target: [digestDelivery.userId, digestDelivery.organizationId],
      set: { cursorAt: windowStart, nextRunAt: new Date(now.getTime() - 1000), claimedAt: null },
    });
}

const deliveryOf = (userId: string) =>
  db.query.digestDelivery.findFirst({
    where: and(eq(digestDelivery.userId, userId), eq(digestDelivery.organizationId, "oA")),
  });

async function setOrganizationDefaults(
  values: Partial<typeof organizationDigestSetting.$inferInsert>,
) {
  await db
    .insert(organizationDigestSetting)
    .values({ organizationId: "oA", ...values })
    .onConflictDoUpdate({ target: organizationDigestSetting.organizationId, set: values });
}

describe("runDueDigests", () => {
  it("does nothing — and moves no cursor — while SMTP is unconfigured", async () => {
    isMailConfigured.mockReturnValue(false);
    await makeDue("u1");
    await recordEvent({
      id: "a1",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pPub",
      actorId: "u2",
      title: "Startseite",
    });

    const summary = await runDueDigests(dbAs, { now });

    expect(summary.reason).toBe("smtp-not-configured");
    expect(deliverMail).not.toHaveBeenCalled();
    // Critically: the window is still open, so configuring mail later reports
    // the events instead of skipping them.
    expect((await deliveryOf("u1"))?.cursorAt).toEqual(windowStart);
  });

  it("gives every member a delivery row, including those who never opened the settings", async () => {
    await setOrganizationDefaults({ frequency: "daily", hour: 8, timezone: "UTC" });

    const summary = await runDueDigests(dbAs, { now });

    expect(summary.adopted).toBe(3);
    // u1 has no `user_digest_setting` row at all and is still scheduled.
    const delivery = await deliveryOf("u1");
    expect(delivery?.nextRunAt).toBeInstanceOf(Date);
    // Adopted now, so the first digest starts here rather than replaying history.
    expect(delivery?.cursorAt.getTime()).toBe(now.getTime());
    // Not yet due, so nothing went out.
    expect(deliverMail).not.toHaveBeenCalled();
  });

  it("sends a due digest and reports only what the recipient may read", async () => {
    await setOrganizationDefaults({
      frequency: "daily",
      hour: 8,
      timezone: "UTC",
      categories: ["pages_created", "pages_updated"],
    });
    await makeDue("u1");
    await recordEvent({
      id: "a-pub",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pPub",
      actorId: "u2",
      title: "Startseite",
    });
    await recordEvent({
      id: "a-priv",
      action: "page.created",
      spaceId: "sPriv",
      pageId: "pPriv",
      actorId: "u2",
      title: "Geheimplan",
    });

    const summary = await runDueDigests(dbAs, { now });

    expect(summary.sent).toBe(1);
    expect(deliverMail).toHaveBeenCalledTimes(1);
    const mail = deliverMail.mock.calls[0]![0];
    expect(mail.to).toBe("ada@example.test");
    expect(mail.text).toContain("Startseite");
    // u1 is not a member of the private space — its title must not leak.
    expect(mail.text).not.toContain("Geheimplan");
    expect(mail.html).not.toContain("Geheimplan");
  });

  it("does not send the same digest twice", async () => {
    await setOrganizationDefaults({ frequency: "daily", hour: 8, timezone: "UTC" });
    await makeDue("u1");
    await recordEvent({
      id: "a-once",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pPub",
      actorId: "u2",
      title: "Startseite",
    });

    const first = await runDueDigests(dbAs, { now });
    const second = await runDueDigests(dbAs, { now });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(deliverMail).toHaveBeenCalledTimes(1);
    // The cursor moved past the window, so a re-run finds nothing to report.
    expect((await deliveryOf("u1"))?.cursorAt.getTime()).toBe(now.getTime());
    expect((await deliveryOf("u1"))?.lastSentAt?.getTime()).toBe(now.getTime());
  });

  it("skips the mail on an empty window but still advances the cursor", async () => {
    await setOrganizationDefaults({
      frequency: "daily",
      hour: 8,
      timezone: "UTC",
      skipIfEmpty: true,
    });
    await makeDue("u1");

    const summary = await runDueDigests(dbAs, { now });

    expect(summary.skippedEmpty).toBe(1);
    expect(deliverMail).not.toHaveBeenCalled();
    expect((await deliveryOf("u1"))?.cursorAt.getTime()).toBe(now.getTime());
    expect((await deliveryOf("u1"))?.lastSentAt ?? null).toBeNull();
  });

  it("keeps the window open when the send fails", async () => {
    await setOrganizationDefaults({ frequency: "daily", hour: 8, timezone: "UTC" });
    await makeDue("u1");
    await recordEvent({
      id: "a-fail",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pPub",
      actorId: "u2",
      title: "Startseite",
    });
    deliverMail.mockResolvedValue({ ok: false, error: "connection refused" });

    const summary = await runDueDigests(dbAs, { now });

    expect(summary.failed).toBe(1);
    const delivery = await deliveryOf("u1");
    // Cursor untouched: the retry must report the same events, not skip them.
    expect(delivery?.cursorAt).toEqual(windowStart);
    expect(delivery?.failureCount).toBe(1);
    expect(delivery?.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(delivery?.claimedAt ?? null).toBeNull();
  });

  it("leaves the recipient's own activity out unless they ask for it", async () => {
    await setOrganizationDefaults({ frequency: "daily", hour: 8, timezone: "UTC" });
    await makeDue("u2");
    await recordEvent({
      id: "a-own",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pPub",
      actorId: "u2",
      title: "Von Ben selbst",
    });

    const summary = await runDueDigests(dbAs, { now });

    expect(summary.sent).toBe(0);
    expect(summary.skippedEmpty).toBe(1);
    expect(deliverMail).not.toHaveBeenCalled();
  });
});

describe("organization defaults", () => {
  it("reach a user who has no settings row of their own", async () => {
    await setOrganizationDefaults({ frequency: "weekly", weekday: 3, hour: 6, timezone: "UTC" });

    const { effective, override } = await loadEffectiveDigestSettings(dbAs, "u1", "oA");

    expect(override).toBeNull();
    expect(effective).toMatchObject({ frequency: "weekly", weekday: 3, hour: 6 });
  });

  it("move an inheriting user onto the new schedule immediately", async () => {
    await setOrganizationDefaults({
      frequency: "monthly",
      dayOfMonth: 1,
      hour: 8,
      timezone: "UTC",
    });
    await runDueDigests(dbAs, { now }); // adopts the members
    const before = (await deliveryOf("u1"))?.nextRunAt;

    await setOrganizationDefaults({ frequency: "daily", hour: 8, timezone: "UTC" });
    await rescheduleOrganizationDigests(dbAs, "oA", now);

    const after = (await deliveryOf("u1"))?.nextRunAt;
    expect(after).not.toEqual(before);
    // Daily at 08:00 UTC, evaluated at 09:00 UTC → tomorrow morning.
    expect(after?.toISOString()).toBe("2026-05-05T08:00:00.000Z");
  });

  it("are overridden field by field by a user's own settings", async () => {
    await setOrganizationDefaults({ frequency: "weekly", hour: 8, timezone: "UTC" });
    await db.insert(userDigestSetting).values({
      userId: "u1",
      organizationId: "oA",
      mode: "custom",
      frequency: "daily",
    });

    const { effective } = await loadEffectiveDigestSettings(dbAs, "u1", "oA");

    expect(effective.frequency).toBe("daily");
    // Everything the user did not touch still follows the admin.
    expect(effective.hour).toBe(8);
  });

  it("win again once the admin disallows personal settings", async () => {
    await setOrganizationDefaults({
      frequency: "weekly",
      hour: 8,
      timezone: "UTC",
      allowUserOverride: false,
    });
    await db.insert(userDigestSetting).values({
      userId: "u1",
      organizationId: "oA",
      mode: "custom",
      frequency: "off",
    });

    const { effective, override } = await loadEffectiveDigestSettings(dbAs, "u1", "oA");

    // The row is kept — re-enabling overrides restores it — but ignored.
    expect(override?.frequency).toBe("off");
    expect(effective.frequency).toBe("weekly");
  });
});

describe("collectDigest scopes", () => {
  beforeEach(async () => {
    await recordEvent({
      id: "c-pub",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pPub",
      actorId: "u1",
      title: "Startseite",
    });
    await recordEvent({
      id: "c-priv",
      action: "page.created",
      spaceId: "sPriv",
      pageId: "pPriv",
      actorId: "u1",
      title: "Geheimplan",
    });
  });

  const preferences = {
    frequency: "daily" as const,
    hour: 8,
    weekday: 1,
    dayOfMonth: 1,
    timezone: "UTC",
    categories: ["pages_created" as const],
    scope: "organization" as const,
    skipIfEmpty: true,
    includeOwnActivity: false,
  };

  it("reports both spaces to a member of both", async () => {
    const content = await collectDigest(dbAs, {
      userId: "u2",
      organizationId: "oA",
      preferences,
      from: windowStart,
      to: now,
    });
    expect(content.entries.map((entry) => entry.title).sort()).toEqual([
      "Geheimplan",
      "Startseite",
    ]);
  });

  it('narrows to explicit memberships under "my_spaces"', async () => {
    const content = await collectDigest(dbAs, {
      userId: "u2",
      organizationId: "oA",
      preferences: { ...preferences, scope: "my_spaces" },
      from: windowStart,
      to: now,
    });
    // u2 is an explicit member of the private space only; the public one is
    // readable but not a membership.
    expect(content.entries.map((entry) => entry.title)).toEqual(["Geheimplan"]);
  });

  it("reports nothing for a member of a different organization", async () => {
    const content = await collectDigest(dbAs, {
      userId: "u3",
      organizationId: "oA",
      preferences,
      from: windowStart,
      to: now,
    });
    expect(content.entries).toEqual([]);
  });

  /**
   * A page ACL that narrows *within* a readable space — the branch that only
   * runs when some page carries its own `visibility`, and the one that decides
   * whether a restricted title reaches an inbox.
   */
  it("drops a page the recipient cannot open under a per-page override", async () => {
    await recordEvent({
      id: "c-locked",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pLocked",
      actorId: "u1",
      title: "Gehaltsbaender",
    });

    // The seeded events were all authored by u1, so this case includes own
    // activity — otherwise the actor filter, not the ACL, decides the outcome.
    const acl = { ...preferences, includeOwnActivity: true };

    // u1 reads the public space but is not on the page's own member list, so
    // the sibling page in that same space comes through and this one does not.
    const forU1 = await collectDigest(dbAs, {
      userId: "u1",
      organizationId: "oA",
      preferences: acl,
      from: windowStart,
      to: now,
    });
    expect(forU1.entries.map((entry) => entry.title)).toEqual(["Startseite"]);

    // u2 is on the page's member list, so the same event reaches them.
    const forU2 = await collectDigest(dbAs, {
      userId: "u2",
      organizationId: "oA",
      preferences: acl,
      from: windowStart,
      to: now,
    });
    expect(forU2.entries.map((entry) => entry.title).sort()).toEqual([
      "Gehaltsbaender",
      "Geheimplan",
      "Startseite",
    ]);
  });

  it("never reports a page that was never published", async () => {
    await recordEvent({
      id: "c-draft",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pDraft",
      actorId: "u2",
      title: "Unfertiger Entwurf",
    });

    const content = await collectDigest(dbAs, {
      userId: "u1",
      organizationId: "oA",
      preferences,
      from: windowStart,
      to: now,
    });
    expect(content.entries.map((entry) => entry.title)).not.toContain("Unfertiger Entwurf");
  });

  it("still tells the author about their own unpublished page", async () => {
    await recordEvent({
      id: "c-draft-own",
      action: "page.updated",
      spaceId: "sPub",
      pageId: "pDraft",
      actorId: "u1",
      title: "Unfertiger Entwurf",
    });

    // u2 authored the draft; the event itself came from someone else.
    const content = await collectDigest(dbAs, {
      userId: "u2",
      organizationId: "oA",
      preferences: { ...preferences, categories: ["pages_updated"] },
      from: windowStart,
      to: now,
    });
    expect(content.entries.map((entry) => entry.title)).toEqual(["Unfertiger Entwurf"]);
  });

  it("ignores events outside the window", async () => {
    const content = await collectDigest(dbAs, {
      userId: "u2",
      organizationId: "oA",
      preferences,
      // The window opens *after* both events were recorded.
      from: new Date("2026-05-04T08:45:00Z"),
      to: now,
    });
    expect(content.entries).toEqual([]);
  });
});
