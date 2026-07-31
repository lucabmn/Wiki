# Settings

The `/settings` area, what lives in each tab, and which right unlocks it.

It is split in two: **Konto** (personal, open to every signed-in user) and **Organisation** (only for managers). The layout route no longer gates the whole area — a plain member must be able to reach their own profile and security settings — so each organization tab wraps itself in [`<PermissionGate>`](../apps/web/src/components/settings/permission-gate.tsx). See [Permissions](./permissions.md) for how the checks resolve.

## Tabs

| Route                    | Section      | Gate                                                 | Contents                                                        |
| ------------------------ | ------------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| `/settings/profile`      | Konto        | none                                                 | Display name, avatar URL, e-mail address (+ verification state) |
| `/settings/security`     | Konto        | none                                                 | Password, TOTP two-factor, passkeys, active sessions            |
| `/settings/appearance`   | Konto        | none                                                 | Theme (local to the device)                                     |
| `/settings/organization` | Organisation | `organization:["update"]`, delete needs `["delete"]` | Org name, slug, logo; danger zone                               |
| `/settings/members`      | Organisation | `member:["update"]`                                  | Members, roles/groups per member, invitations                   |
| `/settings/groups`       | Organisation | `ac:["create"]`                                      | Dynamic roles ("groups") and their permission matrix            |
| `/settings/teams`        | Organisation | `team:["create"]`                                    | Teams and their membership                                      |

The sidebar entry points at `/settings/profile` and is visible to everyone; `/settings` redirects there. The nav only renders the **Organisation** group when [`useAnyPermission`](../apps/web/src/lib/permissions.ts) settles as allowed for any of `member:update` / `ac:create` / `organization:update`.

> That OR is **not** the same thing as the backend's "org manager" (`isOrgManager`, which is `member:["update"]` only, and overrides _content_ access — see [Permissions](./permissions.md)). It is deliberately wider: it decides whether the nav group is worth showing at all, and each tab still re-checks its own right.

## Account-level surfaces worth knowing

**Two-factor.** Enabling is two-staged on purpose: `twoFactor.enable` only provisions the secret and returns the TOTP URI plus backup codes; the account is not actually protected until `verifyTotp` confirms the authenticator. Backup codes are stored hashed — the enable dialog is the only place they are ever shown.

Sign-in with 2FA does **not** create a session: `signIn.email` answers `{ twoFactorRedirect: true }` and a short-lived two-factor cookie, and [`/auth/two-factor`](../apps/web/src/routes/auth/two-factor.tsx) finishes it (TOTP or a backup code). Without that route, turning 2FA on would lock the account out.

**Passkeys.** WebAuthn only exists on secure origins (HTTPS, or localhost). A plain-HTTP LAN install — an explicitly supported deployment, see [DEPLOY.md](../DEPLOY.md) — has no `PublicKeyCredential`, so both the settings section and the sign-in button check `window.isSecureContext` and explain themselves instead of throwing on click.

**E-mail change.** Enabled server-side via `user.changeEmail` in [`packages/auth/src/index.ts`](../packages/auth/src/index.ts). An address that was never verified (the common case, since verification is wired but not required) changes immediately; a verified one must be confirmed from a link sent to the **current** inbox. With no `SMTP_HOST` configured that mail is logged instead of sent.

**Session freshness.** `changeEmail` and `twoFactor.disable` sit behind Better Auth's `sensitiveSessionMiddleware`: a session older than `session.freshAge` (24 h by default, not overridden here) is rejected on those two actions and the user has to sign in again. Everything else in the settings area is happy with any valid session.

**Teams.** Teams carry no permissions. They exist so a whole group of people can be granted space or page access in one row (`spaceMember.teamId` / `pageMember.teamId`) — rights still come from roles and groups.

## Not included (v1)

- **Account deletion.** `user.deleteUser` is left disabled: an owner deleting their account would orphan their organizations, and the ownership-transfer flow that would make it safe does not exist yet.
- **Avatar/logo uploads.** Both take a URL. The attachment storage is space-scoped, so it does not fit a user- or org-level image without a separate bucket path.
- **The `admin()` plugin surface** (app-wide user administration: ban, impersonate, list all users) has no UI. It is distinct from org RBAC.
