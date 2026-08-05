# Settings

The `/settings` area, what lives in each tab, and which right unlocks it.

It is split in two: **Konto** (personal, open to every signed-in user) and **Organisation** (only for managers). The layout route no longer gates the whole area — a plain member must be able to reach their own profile and security settings — so each organization tab wraps itself in [`<PermissionGate>`](../apps/web/src/components/settings/permission-gate.tsx). See [Permissions](./permissions.md) for how the checks resolve.

## Tabs

| Route                             | Section      | Gate                                                 | Contents                                                        |
| --------------------------------- | ------------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| `/settings/profile`               | Konto        | none                                                 | Display name, avatar URL, e-mail address (+ verification state) |
| `/settings/security`              | Konto        | none                                                 | Password, TOTP two-factor, passkeys, active sessions            |
| `/settings/appearance`            | Konto        | none                                                 | Theme (local to the device)                                     |
| `/settings/notifications`         | Konto        | none                                                 | Own mention/reply switches and digest schedule                  |
| `/settings/organization`          | Organisation | `organization:["update"]`, delete needs `["delete"]` | Org name, slug, logo; danger zone                               |
| `/settings/members`               | Organisation | `member:["update"]`                                  | Members, roles/groups per member, invitations                   |
| `/settings/groups`                | Organisation | `ac:["create"]`                                      | Dynamic roles ("groups") and their permission matrix            |
| `/settings/teams`                 | Organisation | `team:["create"]`                                    | Teams and their membership                                      |
| `/settings/notification-defaults` | Organisation | `organization:["update"]`                            | Org-wide mention/reply and digest defaults                      |
| `/settings/sso`                   | Organisation | static role `owner`/`admin` (see below)              | OIDC identity providers, SCIM directory-sync connections        |

> **Not in this area:** `/admin` — the instance console (accounts, sessions, instance health, support impersonation). It is gated on `user.role`, not on any organization right, and gets its own sidebar entry. See [Permissions](./permissions.md#instance-admin-vs-org-admin).

The sidebar entry points at `/settings/profile` and is visible to everyone; `/settings` redirects there. The nav only renders the **Organisation** group when [`useAnyPermission`](../apps/web/src/lib/permissions.ts) settles as allowed for any of `member:update` / `ac:create` / `organization:update`.

> That OR is **not** the same thing as the backend's "org manager" (`isOrgManager`, which is `member:["update"]` only, and overrides _content_ access — see [Permissions](./permissions.md)). It is deliberately wider: it decides whether the nav group is worth showing at all, and each tab still re-checks its own right.

## Account-level surfaces worth knowing

**Two-factor.** Enabling is two-staged on purpose: `twoFactor.enable` only provisions the secret and returns the TOTP URI plus backup codes; the account is not actually protected until `verifyTotp` confirms the authenticator. Backup codes are stored hashed — the enable dialog is the only place they are ever shown.

Sign-in with 2FA does **not** create a session: `signIn.email` answers `{ twoFactorRedirect: true }` and a short-lived two-factor cookie, and [`/auth/two-factor`](../apps/web/src/routes/auth/two-factor.tsx) finishes it (TOTP or a backup code). Without that route, turning 2FA on would lock the account out.

**Passkeys.** WebAuthn only exists on secure origins (HTTPS, or localhost). A plain-HTTP LAN install — an explicitly supported deployment, see [DEPLOY.md](../DEPLOY.md) — has no `PublicKeyCredential`, so both the settings section and the sign-in button check `window.isSecureContext` and explain themselves instead of throwing on click.

**E-mail change.** Enabled server-side via `user.changeEmail` in [`packages/auth/src/index.ts`](../packages/auth/src/index.ts). An address that was never verified (the common case, since verification is wired but not required) changes immediately; a verified one must be confirmed from a link sent to the **current** inbox. With no `SMTP_HOST` configured that mail is logged instead of sent.

**Session freshness.** `changeEmail` and `twoFactor.disable` sit behind Better Auth's `sensitiveSessionMiddleware`: a session older than `session.freshAge` (24 h by default, not overridden here) is rejected on those two actions and the user has to sign in again. Everything else in the settings area is happy with any valid session.

**Single Sign-On.** The only organization tab **not** gated by [`<PermissionGate>`](../apps/web/src/components/settings/permission-gate.tsx). Better Auth's SSO and SCIM plugins carry their own authorization (`hasOrgAdminRole` / `hasRequiredRole`), and it only understands the static `owner`/`admin` roles — a dynamic group granting `organization:["update"]` does not pass it. Gating on the wider `hasPermission` check would hand such a member a form the server rejects on submit, so the tab uses [`<OrgAdminGate>`](../apps/web/src/components/settings/org-admin-gate.tsx), which mirrors what is actually enforced (including the comma-separated multi-role string).

A provider is inert until its e-mail domain is verified by DNS TXT record — sign-in through it is refused, and only a verified domain lets an SSO login adopt a pre-existing local account. Removing a provider deletes every `account` row linked to it, so it carries the same type-to-confirm as deleting the organization. SCIM tokens are stored hashed and shown once, like the two-factor backup codes. Full setup flow: [SSO & SCIM](../apps/docs/content/docs/concepts/sso.mdx).

**Notifications.** Two mechanisms, two sections in the same tab. The _digest_ is the scheduled broadcast summary (by mail). _Erwähnungen & Antworten_ are directed events — being named with `@`, or someone replying to your comment — and land in the in-app inbox (the bell in the sidebar, `/inbox`); they need no SMTP. Both follow the same layering: the organization row holds complete defaults, a user row is sparse, and **no user row means "inherit"**, so changing the defaults still reaches everyone who never opted out. A recipient is only notified about a page they may actually read — the check runs both on delivery and again when the inbox is served, because a page can be restricted after the fact.

**Teams.** Teams carry no permissions. They exist so a whole group of people can be granted space or page access in one row (`spaceMember.teamId` / `pageMember.teamId`) — rights still come from roles and groups.

## Not included (v1)

- **Account deletion.** `user.deleteUser` is left disabled: an owner deleting their account would orphan their organizations, and the ownership-transfer flow that would make it safe does not exist yet.
- **Avatar/logo uploads.** Both take a URL. The attachment storage is space-scoped, so it does not fit a user- or org-level image without a separate bucket path.
- **The `admin()` plugin surface** (app-wide user administration: ban, impersonate, list all users) has no UI. It is distinct from org RBAC.
- **SAML.** The SSO plugin supports it server-side, but `/settings/sso` registers OIDC providers only — SAML needs certificates and assertion mappings that do not fit a dialog, and OIDC covers Entra ID, Okta, Keycloak, Authentik and Google Workspace. IdP-initiated flows are likewise not wired up.
- **SCIM `Groups`.** Only the `Users` resource is implemented by the plugin; teams and groups stay managed here.
