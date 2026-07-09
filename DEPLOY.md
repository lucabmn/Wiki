# Deployment

Nilovon Wiki is a self-hosted docker-compose stack: **web** (:3001), **server**
(:3000), **collab** (:1234) and **postgres**. There is no managed/cloud target —
you run it on your own host.

The only hard requirement on the host is **Docker with the Compose plugin**.
Database migrations run automatically inside the stack (one-shot `migrate`
service) — no Node/pnpm needed for install, update, or operation.

## Quick start (localhost)

```sh
git clone https://github.com/Nilovon/Wiki.git && cd Wiki
curl -fsSLo installer "https://github.com/Nilovon/Wiki/releases/latest/download/nilovon-wiki-installer-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
chmod +x installer && ./installer      # → "Installieren"
```

The installer is a self-contained terminal wizard (no Node/pnpm/Bun needed).
It generates strong secrets, writes the `.env` files, builds the images,
starts the stack — migrations run automatically inside it — and waits for the
health checks. Then open `http://localhost:3001` and register the first user
(onboarding creates the first organization).

From a checkout with the dev toolchain, `pnpm dev:tui` runs the same wizard.

> Plain-HTTP installs issue auth cookies with `SameSite=Lax`, so login also
> works on a LAN IP — TLS is only mandatory when the web app and API live on
> different registrable domains.

Manual equivalent, without the script:

```sh
cp .env.example .env    # fill in POSTGRES_PASSWORD + BETTER_AUTH_SECRET
                        # (generate each with: openssl rand -base64 48)
docker compose up -d --build
```

Placeholder or low-entropy secrets are rejected at startup by design.

## Production (public domain, HTTPS)

The repo ships a Caddy reverse proxy that provisions Let's Encrypt certificates
automatically.

### 1. DNS

Point three records at the host:

| Record               | Serves       |
| -------------------- | ------------ |
| `wiki.example.com`   | web app      |
| `api.example.com`    | API server   |
| `collab.example.com` | collab (WSS) |

### 2. Install

Run the installer and enter the public URLs in the form:

- Web-URL `https://wiki.example.com`
- Server-URL `https://api.example.com`
- Collab-URL `wss://collab.example.com`
- TLS-E-Mail `admin@example.com` (Let's Encrypt contact)

With `https` URLs the installer writes the domain config (`WEB_DOMAIN`,
`API_DOMAIN`, `COLLAB_DOMAIN`, `ACME_EMAIL`) plus generated secrets into
`.env` and brings the stack up **with the production overlay** automatically.

Manual equivalent: copy `.env.example` to `.env`, fill in the secrets and the
production section, then

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

> `VITE_*` are compiled into the web bundle at **build time** — changing a
> domain means rebuilding the web image
> (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build web`).

The prod overlay ([docker-compose.prod.yml](docker-compose.prod.yml)):

- adds **Caddy** on 80/443 (auto-TLS via [Caddyfile](Caddyfile)),
- **un-publishes** the app ports (only Caddy is public),
- derives `BETTER_AUTH_URL`/`CORS_ORIGIN` from the domains so Caddy, CORS, and
  auth can never disagree,
- sets every service to `restart: always`.

Postgres is bound to `127.0.0.1:5432` in the base file already — it is never
reachable from the network.

Open `https://wiki.example.com` and register.

## Updates

Easiest: run the installer again → **"Updaten"** (`git pull --ff-only`, rebuild,
restart — with the TLS overlay when the install is https).

Manual equivalent:

```sh
git pull --ff-only
docker compose up -d --build                      # local
# or, with the prod overlay:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The `migrate` service applies any new database migrations before the app
services restart. Migrations are versioned SQL files
(`packages/db/src/migrations`) tracked in the database — re-running is a no-op,
and destructive schema diffs can no longer be auto-applied (the previous
`drizzle-kit push --force` flow could silently drop data).

> **Upgrading an install created before the migration switch:** the schema was
> applied with `db push` and the migrations table doesn't exist yet, so the
> `migrate` service would try to re-create existing tables. Take a backup,
> recreate the database volume (`docker compose down -v`), start fresh, and
> restore your data — or baseline manually before updating.

## Backups

Postgres holds everything (pages, Yjs snapshots, users). Back it up:

```sh
docker exec nilovon-wiki-postgres pg_dump -U postgres nilovon-wiki | gzip > backup-$(date +%F).sql.gz
```

Restore into a fresh stack (empty database):

```sh
gunzip -c backup-2026-07-09.sql.gz | docker exec -i nilovon-wiki-postgres psql -U postgres nilovon-wiki
```

Automate it with cron, e.g. daily at 03:00 with 14 days retention:

```cron
0 3 * * * cd /path/to/Wiki && docker exec nilovon-wiki-postgres pg_dump -U postgres nilovon-wiki | gzip > /var/backups/wiki-$(date +\%F).sql.gz && find /var/backups -name 'wiki-*.sql.gz' -mtime +14 -delete
```

Keep the `.env` file (or at least `BETTER_AUTH_SECRET` and
`POSTGRES_PASSWORD`) with your backups — sessions and collab tokens are signed
with it.

## Health & monitoring

- `GET http://<api>/health` — deep health check (verifies database
  connectivity), used by the compose healthchecks. Returns `503` when the
  database is unreachable.
- Container logs are JSON-file capped at 10 MB × 3 files per service.
