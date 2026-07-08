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

Copy the example env files and fill in values:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Apply the schema to your local database:

```bash
pnpm db:push
```

## Development

```bash
pnpm dev              # start all apps (web on :3001, server on :3000)
pnpm dev:web          # web only
pnpm dev:server       # server only
pnpm dev:tui          # terminal UI only
```

## Checks

Run these before opening a PR — CI runs the same set:

```bash
pnpm test             # run tests (turbo run test)
pnpm check-types      # TypeScript across all packages
pnpm check            # oxlint + oxfmt
```

Git hooks are managed by [lefthook](https://github.com/evilmartians/lefthook) (installed with `pnpm install`). The pre-commit hook runs `oxlint --fix` and `oxfmt --write` on staged files and re-stages the fixes.

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

## Security issues

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
