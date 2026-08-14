// Access-control definitions for the organization plugin.
//
// Must stay server-free: this module is imported by both the server
// (`@nilovon-wiki/auth`) and the browser (`@nilovon-wiki/auth/permissions`).
// Importing db/env/./index here would pull the database into the web bundle.
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// The wiki's permission surface: resource -> grantable actions.
// `...defaultStatements` keeps the built-in org/member/invitation/team
// permissions plus the `ac` resource that gates dynamic-role management.
export const statement = {
  ...defaultStatements,
  space: ["create", "update", "delete"],
  page: ["create", "read", "update", "delete", "publish", "move"],
  comment: ["create", "update", "delete", "moderate"],
  attachment: ["create", "delete"],
  // ── Learning platform ──────────────────────────────────────────────────────
  // Org-level grants answer "may this member start a course at all" and
  // "may they administer courses they are not staff on". What a member may do
  // *inside* one course is decided by their `course_member` role and their
  // enrolment — see `packages/api/src/lib/course-access.ts`. Both layers apply:
  // an org grant never reaches a course the caller cannot already see.
  course: ["create", "read", "update", "delete", "publish", "manage"],
  lesson: ["create", "update", "delete"],
  enrollment: ["create", "manage"],
  submission: ["grade"],
} as const;

export const ac = createAccessControl(statement);

// Built-in roles. Dynamic roles ("groups") are layered on top at runtime and
// live in the DB. Spreading the default role statements keeps owners/admins
// their org-management and `ac` (role-management) permissions.
export const owner = ac.newRole({
  ...ownerAc.statements,
  space: ["create", "update", "delete"],
  page: ["create", "read", "update", "delete", "publish", "move"],
  comment: ["create", "update", "delete", "moderate"],
  attachment: ["create", "delete"],
  course: ["create", "read", "update", "delete", "publish", "manage"],
  lesson: ["create", "update", "delete"],
  enrollment: ["create", "manage"],
  submission: ["grade"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  space: ["create", "update"],
  page: ["create", "read", "update", "delete", "publish", "move"],
  comment: ["create", "update", "delete", "moderate"],
  attachment: ["create", "delete"],
  course: ["create", "read", "update", "delete", "publish", "manage"],
  lesson: ["create", "update", "delete"],
  enrollment: ["create", "manage"],
  submission: ["grade"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  page: ["create", "read", "update"],
  comment: ["create", "update", "delete"],
  attachment: ["create"],
  // A plain member may browse the catalog and enrol themselves. Authoring is
  // not an org-level grant: it comes from being staff on a specific course, so
  // `course:create` is what distinguishes someone who may start one at all.
  course: ["read"],
  enrollment: ["create"],
});

export const roles = { owner, admin, member };

export type Statement = typeof statement;

// Shared, type-safe shape for every permission check (hooks, middleware,
// `hasPermission`). `{ page: ["create"] }` is valid; `{ page: ["nope"] }` errors.
export type PermissionRequest = {
  [K in keyof Statement]?: Statement[K][number][];
};
