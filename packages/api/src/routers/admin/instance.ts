import { count, eq, gt, sql, sum } from "drizzle-orm";
import { z } from "zod";

import { isMailConfigured } from "@nilovon-wiki/auth/mail";
import {
  attachment,
  organization,
  page,
  session,
  space,
  user,
} from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { instanceAdminProcedure } from "../../lib/instance-admin";
import { firstRow } from "../../lib/rows";
import { isStorageConfigured } from "../../lib/storage";
import { InstanceOverviewSchema } from "../../schemas/admin";
import { countInstanceAdmins } from "./users";

const TAGS = ["Admin"];

/** Long enough to survive a slow container start, short enough to not stall the page. */
const COLLAB_PROBE_TIMEOUT_MS = 1500;

function collabUrl(): string {
  return env.COLLAB_INTERNAL_URL ?? `http://127.0.0.1:${env.COLLAB_PORT}`;
}

/**
 * Liveness probe for the collaboration service.
 *
 * It speaks WebSocket, so a plain GET is answered with an error status rather
 * than a document — which is exactly the signal wanted here. *Any* HTTP reply
 * proves the process is listening; only a transport failure or a timeout means
 * unreachable, and that is what breaks collaborative editing for everyone.
 */
async function probeCollab(): Promise<boolean> {
  try {
    await fetch(collabUrl(), {
      method: "GET",
      signal: AbortSignal.timeout(COLLAB_PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

export const adminInstanceRouter = {
  overview: instanceAdminProcedure
    .route({
      method: "GET",
      path: "/admin/instance",
      tags: TAGS,
      summary: "Version, totals and the state of every external dependency",
    })
    .input(z.object({}))
    .output(InstanceOverviewSchema)
    .handler(async ({ context }) => {
      const { db } = context;
      const [users, banned, admins, orgs, spaces, pages, sessions, storageUsed, collabReachable] =
        await Promise.all([
          db.select({ n: count() }).from(user),
          db.select({ n: count() }).from(user).where(eq(user.banned, true)),
          countInstanceAdmins(db),
          db.select({ n: count() }).from(organization),
          db.select({ n: count() }).from(space),
          db.select({ n: count() }).from(page),
          db
            .select({ n: count() })
            .from(session)
            .where(gt(session.expiresAt, sql`now()`)),
          db.select({ bytes: sum(attachment.size) }).from(attachment),
          probeCollab(),
        ]);

      return {
        version: env.APP_VERSION,
        counts: {
          users: firstRow(users).n,
          bannedUsers: firstRow(banned).n,
          admins,
          organizations: firstRow(orgs).n,
          spaces: firstRow(spaces).n,
          pages: firstRow(pages).n,
          activeSessions: firstRow(sessions).n,
        },
        storage: {
          configured: isStorageConfigured(),
          bucket: isStorageConfigured() ? env.S3_BUCKET : null,
          // `sum()` over a bigint column comes back as a numeric string.
          usedBytes: Number(firstRow(storageUsed).bytes ?? 0),
        },
        mail: { configured: isMailConfigured(), host: env.SMTP_HOST ?? null },
        collab: { reachable: collabReachable, url: collabUrl() },
        impersonation: {
          enabled: env.IMPERSONATION_ENABLED,
          maxMinutes: env.IMPERSONATION_MAX_MINUTES,
        },
      };
    }),
};
