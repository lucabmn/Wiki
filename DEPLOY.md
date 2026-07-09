# Deployment

Nilovon Wiki is a self-hosted docker-compose stack: **web** (:3001), **server**
(:3000), **collab** (:1234) and **postgres**. There is no managed/cloud target —
you run it on your own host.

## Local / LAN (no TLS)

```sh
git clone <repo> && cd nilovon-wiki
pnpm install
pnpm dev:tui          # → "Installieren"
```

The installer writes the `.env` files, applies the database schema, runs
`docker compose up -d --build`, and waits for the health checks. Then open
`http://localhost:3001` and register the first user (onboarding creates the
first organization).

Manual equivalent, without the TUI:

```sh
cp apps/server/.env.example apps/server/.env    # edit secrets/URLs
cp apps/web/.env.example    apps/web/.env
cp apps/collab/.env.example apps/collab/.env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 18)" > .env

docker compose up -d --build
# apply the schema against the published port
DATABASE_URL="postgresql://postgres:<pw>@localhost:5432/nilovon-wiki" \
  pnpm --filter @nilovon-wiki/db db:push --force
```

## Production (public domain, HTTPS)

Auth cookies are issued `SameSite=None; Secure`, so browsers **reject them over
plain http** (localhost is the only exception). Production therefore requires
TLS. The repo ships a Caddy reverse proxy that provisions Let's Encrypt
certificates automatically.

### 1. DNS

Point three records at the host:

| Record               | Serves       |
| -------------------- | ------------ |
| `wiki.example.com`   | web app      |
| `api.example.com`    | API server   |
| `collab.example.com` | collab (WSS) |

### 2. Configure

Copy the example and fill in your domains + email:

```sh
cp .env.prod.example .env      # WEB_DOMAIN, API_DOMAIN, COLLAB_DOMAIN, ACME_EMAIL,
                               # POSTGRES_PASSWORD, VITE_SERVER_URL, VITE_COLLAB_URL
```

Set the server/collab URLs to https (the installer TUI's Install form does this
for you if you enter the public URLs there):

- `apps/server/.env` → `BETTER_AUTH_URL=https://api.example.com`, `CORS_ORIGIN=https://wiki.example.com`
- `apps/collab/.env` → same `BETTER_AUTH_URL` / `CORS_ORIGIN`
- root `.env` → `VITE_SERVER_URL=https://api.example.com`, `VITE_COLLAB_URL=wss://collab.example.com`

> `VITE_*` are compiled into the web bundle at **build time** — changing a domain
> means rebuilding the web image.

### 3. Bring it up

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# apply the schema (postgres is bound to 127.0.0.1:5432)
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/nilovon-wiki" \
  pnpm --filter @nilovon-wiki/db db:push --force
```

The prod overlay ([docker-compose.prod.yml](docker-compose.prod.yml)):

- adds **Caddy** on 80/443 (auto-TLS via [Caddyfile](Caddyfile)),
- **un-publishes** the app ports (only Caddy is public),
- binds **Postgres to localhost** only,
- sets every service to `restart: always`,
- overrides `CORS_ORIGIN` to the public web origin.

Open `https://wiki.example.com` and register.

## Updates

From the host checkout:

```sh
pnpm dev:tui          # → "Updaten"   (git pull --ff-only → schema push → rebuild)
```

or manually:

```sh
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/nilovon-wiki" \
  pnpm --filter @nilovon-wiki/db db:push --force
```

## Backups

Postgres holds everything (pages, Yjs snapshots, users). Back it up:

```sh
docker exec nilovon-wiki-postgres pg_dump -U postgres nilovon-wiki | gzip > backup-$(date +%F).sql.gz
```
