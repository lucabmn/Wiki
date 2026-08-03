import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { member, team } from "@nilovon-wiki/db/schema/index";

type PermissionSubject =
  | { subject: "user"; userId?: string }
  | { subject: "team"; teamId?: string }
  | { subject: "role" };

/**
 * Ensures ACL grants cannot reference principals outside the resource's
 * organization. The same NOT_FOUND response covers both unknown and foreign
 * IDs, so tenant membership cannot be probed through the grant endpoint.
 */
export async function assertPermissionSubjectInOrganization(
  db: Database,
  organizationId: string,
  input: PermissionSubject,
): Promise<void> {
  if (input.subject === "user") {
    const membership = input.userId
      ? await db.query.member.findFirst({
          where: and(eq(member.organizationId, organizationId), eq(member.userId, input.userId)),
          columns: { id: true },
        })
      : undefined;
    if (!membership) {
      throw new ORPCError("NOT_FOUND", { message: "User not found in this organization" });
    }
  }

  if (input.subject === "team") {
    const organizationTeam = input.teamId
      ? await db.query.team.findFirst({
          where: and(eq(team.organizationId, organizationId), eq(team.id, input.teamId)),
          columns: { id: true },
        })
      : undefined;
    if (!organizationTeam) {
      throw new ORPCError("NOT_FOUND", { message: "Team not found in this organization" });
    }
  }
}
