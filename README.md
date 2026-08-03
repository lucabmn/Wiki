<div align="center">

# Nilovon Wiki

**A self-hostable, organization-scoped knowledge base — spaces, hierarchical pages, comments, and fine-grained role-based access, built on an end-to-end type-safe TypeScript stack.**

[![CI](https://github.com/lucabmn/Wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/lucabmn/Wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Overview

Nilovon Wiki is a multi-tenant wiki for teams. Every piece of content lives inside an **organization**; content is grouped into **spaces**, and spaces hold a tree of **pages**. Access is governed by Better Auth's organization plugin with dynamic access control, so permissions are enforced server-side and mirrored in the UI.

The codebase is a pnpm + Turborepo monorepo with a strict boundary between the HTTP surface (`apps/server`), the business logic and data contracts (`packages/api`), and the clients that consume them (`apps/web`, `apps/tui`). A single oRPC router definition drives both the type-safe RPC surface and a generated OpenAPI document.

## Features

- **Organizations & members** — multi-tenant by default; every query is org-scoped.
- **Spaces** — group related pages with `public` / `private` / `restricted` visibility.
- **Pages** — draft → published → archived lifecycle, hierarchical nesting with fractional (LexoRank) ordering, per-space auto-deduplicated slugs, and backlink tracking surfaced in the page rail.
- **Comments** — create, resolve, and moderate; author-or-permission authorization.
- **Tags** — space-scoped labels, created and applied inline from the page header.
- **External links** — a curated, reorderable list of references outside the wiki per page; URLs are normalized and scheme-allowlisted to `http(s)` on the server, so a stored link can never become a `javascript:` href.
- **Attachments** — files stored in any S3-compatible object store (a RustFS service ships with the compose stack); uploads and downloads are proxied by the API so the bucket never faces the internet.
- **Email** — invitations, password reset and address verification over SMTP; optional, with delivery disabled when no SMTP host is configured.
- **Favorites & subscriptions** — personal pins and per-page watch lists.
- **Full-text search** — PostgreSQL `tsvector` generated columns with GIN indexes.
- **Activity feed / audit log** — every mutation records an audit row, including destructive deletes.
- **Role-based access control** — static and dynamic roles via Better Auth; see [docs/permissions.md](docs/permissions.md).
- **Guided onboarding** — create an organization and optionally seed sample content.
- **Type-safe API** — one oRPC definition powers both `/rpc` and a generated, versioned OpenAPI spec at `/v1`.

## Tech stack

| Layer           | Technology                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Web client      | [React 19](https://react.dev), [TanStack Start & Router](https://tanstack.com), [Tailwind CSS 4](https://tailwindcss.com) |
| Terminal client | [OpenTUI](https://github.com/sst/opentui) + React _(preview)_                                                             |
| HTTP server     | [Hono](https://hono.dev)                                                                                                  |
| API / RPC       | [oRPC](https://orpc.unnoq.com) with OpenAPI generation                                                                    |
| Auth            | [Better Auth](https://better-auth.com) (organization + dynamic access control)                                            |
| Database / ORM  | [PostgreSQL](https://www.postgresql.org) + [Drizzle ORM](https://orm.drizzle.team)                                        |
| Validation      | [Zod](https://zod.dev)                                                                                                    |
| Tooling         | [pnpm](https://pnpm.io), [Turborepo](https://turbo.build), [Vitest](https://vitest.dev), [Oxlint / Oxfmt](https://oxc.rs) |

## Architecture

```
                 ┌─────────────┐        ┌─────────────┐
   Browser  ───▶ │  apps/web   │        │  apps/tui   │ ◀─── Terminal
                 │ TanStack St │        │  OpenTUI    │
                 └──────┬──────┘        └──────┬──────┘
                        │  type-safe oRPC client │
                        └───────────┬────────────┘
                                    ▼
                            ┌───────────────┐
                            │  apps/server  │  Hono + oRPC handler
                            │  /rpc  /api-… │  (+ generated OpenAPI)
                            └───────┬───────┘
                                    ▼
                            ┌───────────────┐
                            │ packages/api  │  routers · schemas · access control
                            └───────┬───────┘
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
      │ packages/db  │     │ packages/auth│      │ packages/env │
      │ Drizzle + PG │     │ Better Auth  │      │ typed t3-env │
      └──────────────┘     └──────────────┘      └──────────────┘
```

Reads are gated on **space visibility** (`packages/api/src/lib/access.ts`); mutations are gated on **organization role** (`assertOrgPermission`). Every write runs in a transaction and appends an audit row.

## Self-hosting

The only requirement is Docker (with the Compose plugin). Clone the repo,
download the guided installer from GitHub Releases, run it:

```bash
git clone https://github.com/lucabmn/Wiki.git && cd Wiki
curl -fsSLo installer "https://github.com/lucabmn/Wiki/releases/latest/download/nilovon-wiki-installer-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
chmod +x installer && ./installer
```

The installer is a self-contained terminal wizard: it generates strong
secrets, writes the `.env` files, builds and starts the stack (database
migrations run automatically inside it), and waits for the health checks.
Open **http://localhost:3001** and register; onboarding creates the first
organization.

**Public deployment with automatic HTTPS:** enter `https://` URLs in the
installer form (e.g. `https://wiki.example.com`, API `https://api.example.com`,
Collab `wss://collab.example.com`) plus a Let's Encrypt email — the installer
then brings the stack up behind the bundled Caddy TLS proxy.

The same wizard also handles reconfiguration ("Konfigurieren") and updates
("Updaten"). From a checkout with the dev toolchain you can run it as
`pnpm dev:tui` instead of downloading the binary. See [DEPLOY.md](DEPLOY.md)
for details, manual installation, and backups.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org) LTS
- [pnpm](https://pnpm.io) 10 — pinned via `packageManager`; run `corepack enable` to pick it up automatically
- [Docker](https://www.docker.com) — for the local PostgreSQL database
- [Bun](https://bun.sh) — runs the `server` and `tui` dev scripts

### Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL (detached)
pnpm db:start

# 3. Configure environment
cp apps/server/.env.example apps/server/.env
cp apps/collab/.env.example apps/collab/.env
cp apps/web/.env.example apps/web/.env
#   → set BETTER_AUTH_SECRET in the server AND collab files (same value).
#     Generate one with: openssl rand -base64 48
#     Placeholder values are rejected at startup.

# 4. Apply the schema to your database
pnpm db:push

# 5. Run everything in dev mode
pnpm dev
```

- Web app: **http://localhost:3001**
- API server: **http://localhost:3000** (OpenAPI reference at `/v1`)

## Project structure

```
nilovon-wiki/
├── apps/
│   ├── web/          # React + TanStack Start frontend (:3001)
│   ├── server/       # Hono + oRPC HTTP server (:3000)
│   ├── collab/       # Hocuspocus real-time collaboration server (:1234)
│   └── tui/          # OpenTUI terminal installer (install/configure/update)
├── packages/
│   ├── api/          # oRPC routers, zod schemas, access control (business logic)
│   ├── auth/         # Better Auth config, statement & roles (RBAC source of truth)
│   ├── db/           # Drizzle schema & SQL migrations
│   ├── ui/           # Shared shadcn/ui primitives and styles
│   ├── env/          # Typed environment-variable schemas (t3-env)
│   └── config/       # Shared TypeScript configuration
├── docs/             # Additional documentation
└── docker-compose.yml
```

> **Note:** `apps/tui` is the guided terminal installer — shipped as a self-contained binary on GitHub Releases (built via `pnpm --filter tui compile`), or run from the checkout with `pnpm dev:tui`.

## Available scripts

Run from the repository root.

| Script             | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `pnpm dev`         | Start all apps in development mode                      |
| `pnpm dev:web`     | Start the web app only                                  |
| `pnpm dev:server`  | Start the server only                                   |
| `pnpm dev:tui`     | Start the terminal UI only                              |
| `pnpm build`       | Build all apps and packages                             |
| `pnpm test`        | Run the test suite (Vitest, via Turborepo)              |
| `pnpm check-types` | Type-check every package                                |
| `pnpm check`       | Lint and format with Oxlint + Oxfmt                     |
| `pnpm db:start`    | Start PostgreSQL via Docker Compose (detached)          |
| `pnpm db:push`     | Push the schema directly to the database (dev shortcut) |
| `pnpm db:generate` | Generate SQL migrations from schema changes             |
| `pnpm db:migrate`  | Apply pending database migrations                       |
| `pnpm db:studio`   | Open Drizzle Studio                                     |
| `pnpm docker:up`   | Build and start the full Docker Compose stack           |
| `pnpm docker:down` | Stop the Docker Compose stack                           |

## Deployment

The recommended path is the installer (see [Self-hosting](#self-hosting) above and [DEPLOY.md](DEPLOY.md)). The stack is a docker-compose file with four services plus a one-shot `migrate` service that applies the versioned database migrations automatically before the apps start.

> Cookie behavior: over HTTPS auth cookies are issued `SameSite=None; Secure` (supports web and API on different subdomains). Over plain HTTP they fall back to `SameSite=Lax`, so localhost and LAN pilots work without TLS — production deployments should still use the HTTPS overlay.

```bash
pnpm docker:up      # build + start (web :3001, server :3000, collab :1234, postgres 127.0.0.1:5432)
pnpm docker:logs    # tail logs
pnpm docker:down    # stop
```

### Environment variables

Docker installs are configured entirely through the root **`.env`** (written by the installer; annotated template in [.env.example](.env.example)):

| Variable                                                            | Required   | Description                                                       |
| ------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                                 | yes        | Database password (generated by the installer)                    |
| `BETTER_AUTH_SECRET`                                                | yes        | Auth signing secret, min 32 chars — placeholders are rejected     |
| `BETTER_AUTH_URL` / `CORS_ORIGIN`                                   | production | Public API URL / web origin (derived from domains in the overlay) |
| `VITE_SERVER_URL` / `VITE_COLLAB_URL`                               | production | URLs baked into the web bundle at build time                      |
| `WEB_DOMAIN`, `API_DOMAIN`, `COLLAB_DOMAIN`, `ACME_EMAIL`           | production | Domains + Let's Encrypt email for the Caddy overlay               |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no         | Mail delivery; without `SMTP_HOST` mails are not sent             |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                          | yes        | Generated credentials for bundled RustFS attachment storage       |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`      | no         | Override the bundled S3-compatible storage configuration          |
| `BACKUP_KEEP_DAYS`                                                  | no         | Retention for the opt-in `backup` compose profile (default 14)    |

For local development (`pnpm dev`), each app reads its own `.env` file instead:

**`apps/server/.env`**

| Variable                                 | Required | Description                                         |
| ---------------------------------------- | -------- | --------------------------------------------------- |
| `DATABASE_URL`                           | yes      | PostgreSQL connection string                        |
| `BETTER_AUTH_SECRET`                     | yes      | Auth signing secret (min 32 chars, no placeholders) |
| `BETTER_AUTH_URL`                        | yes      | Public URL of the server                            |
| `CORS_ORIGIN`                            | yes      | Allowed origin of the web app                       |
| `NODE_ENV`                               | no       | `development` (default) / `production` / `test`     |
| `APP_NAME`                               | no       | Display name used by auth flows (white-labeling)    |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` | no       | Per-IP requests/minute for the API / auth routes    |
| `RATE_LIMIT_SCIM_MAX`                    | no       | Per-IP requests/minute for SCIM (default `1200`)    |
| `SMTP_*`                                 | no       | SMTP delivery; unset `SMTP_HOST` disables delivery  |
| `S3_*`                                   | no       | S3-compatible attachment storage                    |
| `ATTACHMENT_MAX_MB`                      | no       | Per-file upload ceiling (default 25)                |

**`apps/collab/.env`**

| Variable             | Required | Description                                        |
| -------------------- | -------- | -------------------------------------------------- |
| `DATABASE_URL`       | yes      | Same database as the server                        |
| `BETTER_AUTH_SECRET` | yes      | Same secret as the server (verifies collab tokens) |
| `COLLAB_PORT`        | no       | WebSocket port (default 1234)                      |

**`apps/web/.env`**

| Variable          | Required | Description                                      |
| ----------------- | -------- | ------------------------------------------------ |
| `VITE_SERVER_URL` | yes      | URL the browser uses to reach the API            |
| `VITE_COLLAB_URL` | yes      | WebSocket URL of the collab service (`ws(s)://`) |

See the `.env.example` files for annotated placeholders.

## Documentation

- [Permissions (RBAC)](docs/permissions.md) — how authorization works, and how to use it on the backend and frontend.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, and please open an issue before starting large changes. Report security vulnerabilities privately per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Nilovon
