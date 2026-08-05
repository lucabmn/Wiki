import { adminAuditRouter } from "./audit";
import { adminInstanceRouter } from "./instance";
import { adminOrganizationRouter } from "./organizations";
import { adminSessionRouter } from "./sessions";
import { adminUserActionRouter } from "./user-actions";
import { adminUserRouter } from "./users";

/**
 * The instance-admin surface.
 *
 * Every procedure is built from `instanceAdminProcedure`, so the gate is the
 * server's, not the navigation's: hiding the menu changes nothing, and an org
 * owner reaching these paths gets FORBIDDEN like anyone else.
 *
 * Impersonation itself is deliberately absent. It is started and stopped
 * straight against `/api/auth/admin/*` from the browser, because both ends set
 * session cookies that would have to be tunnelled back through oRPC otherwise.
 * The audit hooks in `packages/auth` cover it either way.
 */
export const adminRouter = {
  instance: adminInstanceRouter,
  users: { ...adminUserRouter, ...adminUserActionRouter },
  sessions: adminSessionRouter,
  organizations: adminOrganizationRouter,
  audit: adminAuditRouter,
};
