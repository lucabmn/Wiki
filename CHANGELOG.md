# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org). What counts as a
breaking change — and what the project treats as a public contract — is defined
in [GOVERNANCE.md](GOVERNANCE.md#releases-and-versioning).

While the major version is `0`, the **minor** version carries breaking changes:
`0.x → 0.(x+1)` may break, `0.x.y → 0.x.(y+1)` may not.

## [Unreleased]

Nothing has been tagged yet. This section is the release notes for the first
tag; entries are added as changes land.

### Added

- **Registration policy.** `SIGNUP_MODE` (`open` | `invite` | `closed`), an
  optional `SIGNUP_ALLOWED_EMAIL_DOMAINS` allowlist, and an optional
  `REQUIRE_EMAIL_VERIFICATION`. Enforced in the auth layer, not just in the UI.
  SSO sign-in and SCIM directory sync are deliberately unaffected. See
  [Who may register](DEPLOY.md#who-may-register).
- **Dependency health endpoint.** `GET /health/ready` probes the database,
  object storage and the collaboration service and reports each separately;
  `GET /health/live` answers without touching anything. `GET /health` keeps its
  old meaning (database only) and stays what the orchestrator watches.
- **Complete backups.** A backup run now produces one recovery set — the
  database dump _and_ every attachment byte, under one timestamp, with SHA-256
  checksums. Optional at-rest encryption (`BACKUP_PASSPHRASE`) and an optional
  offsite copy (`BACKUP_REMOTE_*`). Backup age drives the container's
  healthcheck, and `restore` is a single command that verifies checksums before
  writing. See [Backups](DEPLOY.md#backups).
- **Browser security headers** on every host behind the bundled Caddy proxy:
  HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Cross-Origin-Opener-Policy` and a `Permissions-Policy` that grants nothing.
- **`pages.tree`** — the space's page tree as ids and titles, without page
  bodies. The sidebar and breadcrumb use it instead of `pages.list`.
- **Audit coverage** for per-page and per-space access-control changes, member
  role changes and removals, and comment edits.
- **Keyboard page reordering.** The page tree can be reordered from the keyboard
  and from a menu, not only by dragging.
- **Community and governance files:** `CODE_OF_CONDUCT.md`, `SUPPORT.md`,
  `GOVERNANCE.md`, `MAINTAINERS.md`, `.github/CODEOWNERS`, this changelog.
- **Release supply chain:** SHA-256 checksums, an SBOM and build provenance
  attestations for installer binaries and container images. See
  [Verifying a release](DEPLOY.md#verifying-a-release).
- **Automated dependency updates and code scanning:** Dependabot, CodeQL, and a
  dependency review on pull requests.
- **Deployment smoke test.** CI boots the full compose stack, runs the
  migrations, registers, creates a page, uploads and downloads an attachment,
  connects to collaboration over WebSocket, and performs a backup _and a
  restore_ — on every change.
- **Privacy and data-lifecycle documentation** (`docs/privacy.md`): what
  personal data is stored, where it goes, how it is deleted, and what a
  self-hoster is responsible for.

### Changed

- `ATTACHMENT_MAX_MB`, the PDF export ceilings, the rate limits and `APP_NAME`
  now reach the container through `docker-compose.yml`. They were documented in
  `.env.example` but never passed through, so setting them did nothing.
- Container services drop the Linux capabilities they do not need, run with
  `no-new-privileges`, and carry default memory and process limits.
- `REQUIRE_EMAIL_VERIFICATION=true` without `SMTP_HOST` now refuses to start
  rather than creating accounts that can never sign in.
- Workflow permissions are least-privilege: read-only at the top of every
  workflow, widened per job only where something is actually published.
- README no longer claims that _every_ mutation is audited. It now describes what
  is actually covered and points at the action enum.

### Fixed

- **Creating an organization returned a 500.** Better Auth's organization plugin
  declares `team.memberCount` and `teamMember.membershipKey`; the hand-maintained
  Drizzle schema had neither, and creating an organization also creates its
  default team — so it failed outright on every install. Found by the new
  deployment smoke test, which is the only thing that exercises the real auth
  adapter (the API integration tests mock it wholesale). A unit test now asserts
  the Drizzle schema covers every field the plugins declare, so the next
  dependency bump that drifts fails in CI rather than in production.

### Migrations

- `0018` adds the new access-control and `comment.updated` values to the
  `wiki.activity_action` enum. Additive only; no existing row changes.
- `0019` adds `auth.team.member_count` and `auth.team_member.membership_key`,
  and backfills the member count from the existing membership rows — the column
  defaults to 0 and Better Auth only increments from there, so without the
  backfill every existing team would report zero members permanently.

[Unreleased]: https://github.com/lucabmn/Wiki/commits/main
