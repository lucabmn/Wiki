# Personal data, and what a self-hoster is responsible for

Wiki is self-hosted. Nobody but you runs it, nobody but you holds the data, and
no telemetry leaves your instance. That also means the obligations are yours: in
data-protection terms **you are the controller**, and this project is a tool you
operate rather than a service you buy.

This document is the inventory those obligations start from — what is stored,
where it goes, how long it lives, and how to get it out or delete it. It is not
legal advice, and it deliberately describes the software rather than your
deployment: your reverse proxy's access log, your host's backups and your mail
provider are yours to account for.

## What is stored

### Directly identifying

| Data                                                 | Where                             | Why it exists                                               |
| ---------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| Name, email address, avatar URL                      | `auth.user`                       | identity; the address is also the login and the mail target |
| Password hash                                        | `auth.account`                    | email/password sign-in                                      |
| Two-factor secret and backup codes                   | `auth.two_factor`                 | second factor                                               |
| Passkey public keys                                  | `auth.passkey`                    | passwordless sign-in                                        |
| Sessions: token, IP address, user agent, expiry      | `auth.session`                    | keeping people signed in; the session list they can revoke  |
| Organization membership and role                     | `auth.member`                     | who is in which tenant, and what they may do                |
| Invitations: address, role, inviter, expiry          | `auth.invitation`                 | pending invitations                                         |
| SSO/SCIM provider config and directory-sync mappings | `auth.sso_provider`, `auth.scim*` | enterprise sign-in, where configured                        |

### Attributed activity

| Data                                                          | Where                                                      | Why it exists                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Every audited action, with actor id (and impersonating admin) | `wiki.activity`                                            | the audit log and the activity feed            |
| Instance-admin actions (bans, role changes, impersonation)    | `admin.admin_audit`                                        | accountability for operating the instance      |
| Page authorship: `created_by`, `last_edited_by`, revisions    | `wiki.page`, `wiki.page_revision`                          | attribution and version history                |
| Comment authorship and mentions                               | `wiki.comment`, notification rows                          | discussion, and telling people they were named |
| Favourites, subscriptions, notification preferences           | `wiki.favorite`, `wiki.page_subscription`, digest settings | personal preferences                           |
| Uploader of an attachment                                     | `wiki.attachment`                                          | attribution and quota accounting               |

### Content

Page bodies, comments and uploaded files are whatever your users put in them.
**Assume they contain personal data**, because in a company wiki they routinely
do — meeting notes, org charts, performance discussions, customer names.

### What is _not_ stored

- **No telemetry.** The application makes no outbound call to this project or
  anyone else. Turbo's telemetry is disabled in CI and is a build-time tool, not
  part of the running app.
- **No analytics, no third-party scripts.** The Content-Security-Policy shipped
  in the `Caddyfile` permits no third-party script origin at all.
- **No mail bodies in logs.** Invitation and password-reset links are never
  logged; only that a mail was sent.
- **Email addresses are masked in request logs** (`maskEmail` on the logging
  middleware), so an address does not end up in every log line.

## Where data goes

Everything stays on your host, with three exceptions **you configure**:

| Destination       | What leaves                                                   | Controlled by                          |
| ----------------- | ------------------------------------------------------------- | -------------------------------------- |
| Your SMTP server  | invitations, password resets, digests, notification mails     | `SMTP_*`                               |
| Webhook endpoints | audit events an org admin subscribed to, incl. access changes | per-organization webhook configuration |
| Offsite backups   | a full copy of everything, including personal data            | `BACKUP_REMOTE_*`                      |

Each is a processor relationship you have to account for. The webhook one is the
easy one to forget: an org admin can point events at Slack without the instance
operator being involved, which is exactly why the endpoint and its configuration
changes are themselves audited.

## How long it lives

See [Which data lives how long](../DEPLOY.md#which-data-lives-how-long) for the
full picture. In short:

- Content lives until somebody deletes it. Deleting is a soft delete with a
  **30-day trash window** by default, then a purge.
- The **activity log is kept forever by default**. An organization admin can set
  a window under **Einstellungen → Daten & Fristen**; four governance actions are
  exempt from it, so shortening the window cannot erase the record of who
  shortened it.
- **Sessions** expire on their own and can be revoked per session by the user or
  by an instance admin.

### Backups are the exception, and it is deliberate

A retention purge does **not** reach into backups. A dump taken before a purge
still contains the rows that purge removed, and it will keep containing them for
as long as you keep that dump.

This is the point of a backup, and it is also a fact you have to state in your
own records:

- Set a backup retention (`BACKUP_KEEP_DAYS`, plus the remote's lifecycle
  policy) that you can actually justify.
- When you erase somebody's data on request, the erasure is complete only once
  every backup made before it has aged out. Say so, with the timescale.
- Encrypt offsite backups (`BACKUP_PASSPHRASE`) — that is the copy furthest from
  your control.

## Answering a data-subject request

**"What do you have about me?"**
An instance admin can read the account, its sessions and its activity in the
admin console. For content, the organization's Space exports carry authorship
and comments — Markdown, HTML or JSON, with attachments, see
[docs/export-format.md](export-format.md). There is no one-click per-person
export; assembling one is a manual job, and you should know that before you are
asked.

**"Correct this."**
Name, email and avatar are editable by the user under **Einstellungen**; an
instance admin can change them for somebody else. Content is edited in place,
with the change recorded in the page history.

**"Delete me."**
An instance admin removes the account in the admin console. What that does and
does not do:

- The account, its sessions, passkeys, two-factor secrets and memberships go.
- **Content stays.** Pages, comments and revisions the person wrote remain, with
  the author reference nulled — the wiki does not collapse because somebody
  left, and the remaining team keeps the knowledge they depend on.
- If the _content_ must go too, delete it explicitly before the account. Content
  under a deletion block cannot be removed until the block is released — by
  design, and something to check before promising a deadline.
- Backups still hold both until they age out (above).

**"Export everything."**
Space export produces a portable archive per space. Organization-wide export is
a loop over the spaces; there is no single "export the tenant" button today.

## Deleting an organization

Removing an organization removes its spaces, pages, comments, attachments,
memberships, invitations, webhooks, SSO providers and audit rows by database
cascade. Attachment **bytes** in object storage follow the attachment rows.
Verify against your own install before relying on it — and note that the same
backup caveat applies.

## What you are responsible for

The software cannot do these for you:

1. **A record of processing** — this document is the inventory it starts from,
   not the record itself.
2. **A lawful basis** for what your organization puts in the wiki, and telling
   your users about it.
3. **Processor agreements** with your mail provider, your offsite backup
   provider and any webhook receiver.
4. **Access control that matches your policy.** The tooling is here
   ([docs/permissions.md](permissions.md)); the decisions are yours.
5. **Deciding who may register** — see
   [Who may register](../DEPLOY.md#who-may-register). Open registration on an
   internet-reachable private wiki is a configuration choice, and the default.
6. **Retention windows** you can defend, including on backups.
7. **Breach notification.** Nobody else can see your instance; nobody else can
   notice.
8. **Your infrastructure's own logs** — reverse proxy access logs, host
   backups, hypervisor snapshots. They contain IP addresses and URLs that this
   application never writes down.
