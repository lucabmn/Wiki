<div align="center">

# Nilovon Wiki

**A self-hostable, organization-scoped knowledge base — spaces, hierarchical pages, comments, and fine-grained role-based access, built on an end-to-end type-safe TypeScript stack.**

[![CI](https://github.com/Nilovon/Wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/Nilovon/Wiki/actions/workflows/ci.yml)
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
- **Pages** — draft → published → archived lifecycle, hierarchical nesting with fractional (LexoRank) ordering, per-space auto-deduplicated slugs, and backlink tracking.
- **Comments** — create, resolve, and moderate; author-or-permission authorization.
- **Tags & attachments** — organize and enrich pages.
- **Favorites & subscriptions** — personal pins and per-page watch lists.
- **Full-text search** — PostgreSQL `tsvector` generated columns with GIN indexes.
- **Activity feed / audit log** — every mutation records an audit row, including destructive deletes.
- **Role-based access control** — static and dynamic roles via Better Auth; see [docs/permissions.md](docs/permissions.md).
- **Guided onboarding** — create an organization and optionally seed sample content.
- **Type-safe API** — one oRPC definition powers both `/rpc` and a generated OpenAPI spec at `/api-reference`.

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

## Getting started

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
cp apps/web/.env.example apps/web/.env
#   → set BETTER_AUTH_SECRET (min 32 chars) and review the rest

# 4. Apply the schema to your database
pnpm db:push

# 5. Run everything in dev mode
pnpm dev
```

- Web app: **http://localhost:3001**
- API server: **http://localhost:3000** (OpenAPI reference at `/api-reference`)

## Project structure

```
nilovon-wiki/
├── apps/
│   ├── web/          # React + TanStack Start frontend (:3001)
│   ├── server/       # Hono + oRPC HTTP server (:3000)
│   └── tui/          # OpenTUI terminal client (preview — mock data)
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

> **Note:** `apps/tui` is an early preview that currently renders mock data; it is not yet wired to the live server.

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

> **HTTPS is required.** Auth cookies are issued with `SameSite=None; Secure` to support the cross-site web ↔ server setup, so browsers only accept them over HTTPS (localhost is the sole exception). Put the server behind TLS and set `BETTER_AUTH_URL` and `CORS_ORIGIN` to `https://` URLs.

### Docker Compose

The bundled stack builds the `web` and `server` images and provisions PostgreSQL:

```bash
pnpm docker:up      # build + start (web :3001, server :3000, postgres :5432)
pnpm docker:logs    # tail logs
pnpm docker:down    # stop
```

Per-app environment is read from each app's `.env` file (public web variables are baked in at build time) and overridden in `docker-compose.yml` for container networking.

### Environment variables

**`apps/server/.env`**

| Variable             | Required | Description                                     |
| -------------------- | -------- | ----------------------------------------------- |
| `DATABASE_URL`       | yes      | PostgreSQL connection string                    |
| `BETTER_AUTH_SECRET` | yes      | Auth signing secret (min 32 characters)         |
| `BETTER_AUTH_URL`    | yes      | Public URL of the server (HTTPS in production)  |
| `CORS_ORIGIN`        | yes      | Allowed origin of the web app                   |
| `NODE_ENV`           | no       | `development` (default) / `production` / `test` |

**`apps/web/.env`**

| Variable          | Required | Description                           |
| ----------------- | -------- | ------------------------------------- |
| `VITE_SERVER_URL` | yes      | URL the browser uses to reach the API |

See the `.env.example` files for annotated placeholders.

## Documentation

- [Permissions (RBAC)](docs/permissions.md) — how authorization works, and how to use it on the backend and frontend.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, and please open an issue before starting large changes. Report security vulnerabilities privately per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Nilovon
