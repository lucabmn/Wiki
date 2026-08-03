# Deployment

Wiki is a self-hosted docker-compose stack: **web** (:3001), **server**
(:3000), **collab** (:1234) and **postgres**. There is no managed/cloud target —
you run it on your own host.

The only hard requirement on the host is **Docker with the Compose plugin**.
Database migrations run automatically inside the stack (one-shot `migrate`
service) — no Node/pnpm needed for install, update, or operation.

## Quick start (localhost)

```sh
git clone https://github.com/lucabmn/Wiki.git && cd Wiki
curl -fsSLo installer "https://github.com/lucabmn/Wiki/releases/latest/download/nilovon-wiki-installer-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
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
cp .env.example .env    # fill in every required secret (DB, auth, and S3)
                        # (generate each with: openssl rand -base64 48)
docker compose up -d --build
```

Placeholder or low-entropy secrets are rejected at startup by design.

### Pull a tagged release instead of building

Tagged releases publish `linux/amd64` and `linux/arm64` images as
`ghcr.io/lucabmn/wiki-{web,server,collab}`. For a localhost install:

```sh
cp .env.example .env    # fill all required secrets
WIKI_VERSION=0.1.0 docker compose pull
WIKI_VERSION=0.1.0 docker compose up -d
```

`latest` points to the newest tagged release. Custom-domain deployments still
build the web image locally because `VITE_SERVER_URL` and `VITE_COLLAB_URL` are
compiled into its bundle; the production overlay enforces that with
`pull_policy: build`.

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

Two things need backing up: **Postgres** (pages, revisions, Yjs snapshots,
users, and all attachment _metadata_) and the **object store** (the attachment
bytes themselves). A database dump alone restores a wiki whose attachments all 404.

### Automatic

```sh
docker compose --profile backup up -d backup
```

Dumps the database nightly into the `nilovon-wiki_nilovon-wiki_backups` volume and prunes
anything older than `BACKUP_KEEP_DAYS` (default 14). This does not snapshot the
object store. Copy database dumps off-host and use the quiesced object-store
procedure below; never archive a live RustFS data volume.

### Manual

Postgres holds everything except attachment bytes. For a consistent recovery
set, first stop application writers, then dump Postgres:

```sh
docker compose stop web server collab
docker exec nilovon-wiki-postgres pg_dump -U postgres nilovon-wiki | gzip > backup-$(date +%F).sql.gz
```

Restore into a fresh stack (empty database) only after restoring the matching
attachment backup below:

```sh
gunzip -c backup-2026-07-09.sql.gz | docker exec -i nilovon-wiki-postgres psql -U postgres nilovon-wiki
```

Automate it with cron, e.g. daily at 03:00 with 14 days retention:

```cron
0 3 * * * cd /path/to/Wiki && docker exec nilovon-wiki-postgres pg_dump -U postgres nilovon-wiki | gzip > /var/backups/wiki-$(date +\%F).sql.gz && find /var/backups -name 'wiki-*.sql.gz' -mtime +14 -delete
```

Attachment bytes live in the object store, not in Postgres. With the bundled
RustFS service that is the `nilovon-wiki_nilovon-wiki_rustfs_data` volume. Stop RustFS before
reading its raw volume, then restart the stack after the archive completes:

```sh
docker compose stop rustfs
docker run --rm -v nilovon-wiki_nilovon-wiki_rustfs_data:/data -v "$PWD":/out alpine \
  tar czf /out/attachments-$(date +%F).tar.gz -C /data .
docker compose up -d
```

Restore the bundled object store only into a stopped, empty RustFS volume. Put
the original `.env` in place first, then:

```sh
docker compose down
docker volume rm nilovon-wiki_nilovon-wiki_postgres_data nilovon-wiki_nilovon-wiki_rustfs_data
docker volume create nilovon-wiki_nilovon-wiki_rustfs_data
docker run --rm \
  -v nilovon-wiki_nilovon-wiki_rustfs_data:/data \
  -v "$PWD":/out \
  alpine sh -c 'cd /data && tar xzf /out/attachments-2026-07-09.tar.gz'
docker compose up -d postgres rustfs rustfs-init
```

Then restore the matching database dump and start the remaining services. Do
not extract over a live or non-empty volume. Treat the database dump and object
archive as one recovery set and verify attachment downloads after restoring.

Keep the `.env` file (especially `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`,
`S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`) with your backups — sessions and
collab tokens are signed with it, and RustFS needs the original credentials.

## Collab on Vercel

The compose deploy above runs collab as a long-lived container, which is what
Hocuspocus is built for. It can also run as a Vercel Function
(`apps/collab/src/vercel.ts`), at a cost — read the limits before choosing it.

**Redis is mandatory.** Hocuspocus holds each document in memory and Vercel
gives no connection affinity, so two people editing the same page routinely land
on different function instances. `@hocuspocus/extension-redis` mirrors updates
and awareness between them over pub/sub; without it the deployment looks healthy
while silently splitting editors into isolated copies. The serverless entry
refuses to boot when `REDIS_URL` is unset for exactly this reason.

Setup:

1. New Vercel project, root directory `apps/collab`. `vercel.json` there already
   sets the build command and rewrites every path to the function.
2. Add a Redis with a **TCP** endpoint (`rediss://…`) — Upstash's REST API
   cannot do pub/sub. Budget two connections per warm instance (pub + sub).
3. Environment variables: `DATABASE_URL`, `BETTER_AUTH_SECRET` (byte-identical
   to the API's — it verifies the collab-token HMAC), `REDIS_URL`.
4. Optionally raise the function's duration cap — it _is_ the reconnect
   interval, and the default is 5 minutes. Left out of the committed
   `vercel.json` because a value above the plan limit fails the deploy (Hobby
   caps at 300s, Pro at 800s). On Pro, add:

   ```json
   "functions": { "api/index.js": { "maxDuration": 800 } }
   ```

5. Rebuild the web app with `VITE_COLLAB_URL=wss://<project>.vercel.app`. It is
   baked in at build time — changing the variable without redeploying web does
   nothing.

Limits you own after this:

- Every socket is closed when the function hits `maxDuration`. The editor
  reconnects on its own (`page-editor.tsx` passes `token` as an async function,
  so it re-mints a collab token each time) — expect a brief "connecting" blip.
- Instances are frozen without `SIGTERM`. The serverless entry compensates with
  a 400 ms / 2 s store debounce and, on socket close, a flush whose `UPDATE`s
  are handed to `waitUntil` — instead of the graceful shutdown the container
  path uses.
- If the WebSocket handshake fails at the root path, the rewrite is not being
  applied to the `Upgrade` request: point `VITE_COLLAB_URL` at
  `wss://<project>.vercel.app/api` and rebuild web.
- Every cross-instance edit takes a Redis round trip.

## Health & monitoring

- `GET http://<api>/health` — deep health check (verifies database
  connectivity), used by the compose healthchecks. Returns `503` when the
  database is unreachable.
- Container logs are JSON-file capped at 10 MB × 3 files per service.
