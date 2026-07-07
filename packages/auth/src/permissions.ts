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
});

export const admin = ac.newRole({
  ...adminAc.statements,
  space: ["create", "update"],
  page: ["create", "read", "update", "delete", "publish", "move"],
  comment: ["create", "update", "delete", "moderate"],
  attachment: ["create", "delete"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  page: ["create", "read", "update"],
  comment: ["create", "update", "delete"],
  attachment: ["create"],
});

export const roles = { owner, admin, member };

export type Statement = typeof statement;

// Shared, type-safe shape for every permission check (hooks, middleware,
// `hasPermission`). `{ page: ["create"] }` is valid; `{ page: ["nope"] }` errors.
export type PermissionRequest = {
  [K in keyof Statement]?: Statement[K][number][];
};
