# Contributing to nilovon-wiki

Thanks for contributing! This document covers how to get a development environment running and what we expect from changes.

## Prerequisites

- [Node.js](https://nodejs.org) (LTS)
- [pnpm](https://pnpm.io) 10 (the repo pins `pnpm@10.32.1` via the `packageManager` field; `corepack enable` picks it up automatically)
- [Docker](https://www.docker.com) (for the local PostgreSQL database)
- [Bun](https://bun.sh) (runtime for the server and TUI dev scripts)

## Setup

```bash
pnpm install          # install all workspace dependencies
pnpm db:start         # start PostgreSQL via docker compose (detached)
```

Copy the example env files and fill in values — **all three**. `pnpm dev` starts
the collaboration service too, and it refuses to boot without its own `.env`:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example    apps/web/.env
cp apps/collab/.env.example apps/collab/.env
```

Generate one secret and use the **same value** in `apps/server/.env` and
`apps/collab/.env` — collab verifies the API's collaboration tokens with it, and
two different secrets produce an editor that connects and then silently fails to
authenticate:

```bash
openssl rand -base64 48
```

(A Docker install is different: there the root `.env` is the single source of
configuration and compose injects everything. The per-app files exist for
`pnpm dev`.)

Apply the schema to your local database:

```bash
pnpm db:push
```

## Development

```bash
pnpm dev              # start all apps (web :3001, server :3000, collab :1234)
pnpm dev:web          # web only
pnpm dev:server       # server only
pnpm dev:collab       # collaboration service only
pnpm dev:tui          # terminal UI only
```

Optional extras for the parts that talk to the outside world:

```bash
docker compose --profile dev up -d mailpit   # mail catcher on http://localhost:8025
                                             # then SMTP_HOST=mailpit, SMTP_PORT=1025
docker compose up -d rustfs rustfs-init      # object storage, for attachments
```

Without those, mail is not delivered and attachments are disabled — both are
supported configurations, not errors. `GET http://localhost:3000/health/ready`
reports each dependency separately if you are unsure what is running.

## Checks

Run these before opening a PR — CI runs the same set:

```bash
pnpm test             # run tests (turbo run test)
pnpm check-types      # TypeScript across all packages
pnpm check            # oxlint + oxfmt
```

Git hooks are managed by [lefthook](https://github.com/evilmartians/lefthook) (installed with `pnpm install`). The pre-commit hook runs `oxlint --fix` and `oxfmt --write` on staged files and re-stages the fixes.

### The deployment smoke test

CI also boots the whole compose stack and drives it over HTTP — registration, a
page, an attachment round-trip, a collaboration socket, and a backup **and
restore** ([`.github/workflows/smoke.yml`](.github/workflows/smoke.yml)). It
exists because the checks above prove the code compiles and its units behave,
and prove nothing about whether the assembled deployment works.

If you touch anything in `docker-compose.yml`, `scripts/backup/`, a Dockerfile,
or the health endpoints, run it locally before pushing:

```bash
cp .env.example .env      # fill in the required secrets
docker compose --profile backup build
docker compose up -d --wait
node scripts/smoke/smoke.mjs
```

## Database scripts

- `pnpm db:generate` — generate SQL migrations from schema changes in `packages/db`
- `pnpm db:migrate` — apply pending migrations
- `pnpm db:push` — push the schema directly (development shortcut)
- `pnpm db:studio` — open Drizzle Studio
- `pnpm db:stop` / `pnpm db:down` — stop / remove the postgres container

## Pull requests

- Keep PRs focused; one logical change per PR.
- Include tests for behavior changes where practical.
- Make sure `pnpm test`, `pnpm check-types`, and `pnpm check` pass.
- Add a [CHANGELOG.md](CHANGELOG.md) entry under **Unreleased** for anything a
  user or an operator would notice. A new env variable, a changed default, or a
  new endpoint all count.
- If your change breaks one of the [public contracts](GOVERNANCE.md#releases-and-versioning)
  — the REST surface, the export format, an env variable, the schema, or a
  compose service or volume name — say so in the PR description and open an
  issue first. Those need agreement before code.

## How decisions get made

[GOVERNANCE.md](GOVERNANCE.md) covers who merges what, which changes need
broader agreement, and what the project considers in scope. Worth two minutes
before a large PR.

## Code of Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting help

Questions about _using_ or _operating_ Wiki belong in [SUPPORT.md](SUPPORT.md) —
it lists where each kind of question goes.

## Security issues

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
