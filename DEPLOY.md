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

### Verifying a release

The documented install path is "download a binary and run it as root", which is
worth being able to check. Every release carries checksums, an SBOM, and
[build provenance](https://slsa.dev/) signed by the workflow that produced it.

**Installer binaries** — checksums catch a truncated or swapped download,
provenance ties the binary to a specific commit, workflow and runner:

```sh
curl -fsSLO https://github.com/lucabmn/Wiki/releases/latest/download/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing

gh attestation verify nilovon-wiki-installer-linux-x64 --repo lucabmn/Wiki
```

**Container images** carry their provenance and an SPDX SBOM in the manifest
itself, so they travel with a `docker pull`:

```sh
gh attestation verify oci://ghcr.io/lucabmn/wiki-server:0.1.0 --repo lucabmn/Wiki
docker buildx imagetools inspect ghcr.io/lucabmn/wiki-server:0.1.0 --format '{{ json .SBOM }}'
```

A failed verification is a reason to stop, not to retry — report it through
[SECURITY.md](SECURITY.md).

For a deployment that must not move underneath you, pin by **digest** rather
than by tag. A tag is a moving pointer; `latest` and even `0.1` are reassigned
by the next release:

```sh
docker buildx imagetools inspect ghcr.io/lucabmn/wiki-server:0.1.0 --format '{{ .Manifest.Digest }}'
# then in .env:
#   WIKI_VERSION=0.1.0@sha256:…
```

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

> Registration is **open** by default. Before the instance is reachable from the
> internet, decide who may create an account — see
> [Who may register](#who-may-register) directly below.

## Who may register

`SIGNUP_MODE` in `.env` governs self-service registration with email and
password:

| Value    | Who gets in                                                      | Fits                       |
| -------- | ---------------------------------------------------------------- | -------------------------- |
| `open`   | anyone who reaches the sign-up form (**default**)                | a public community wiki    |
| `invite` | only addresses with a pending, unexpired organization invitation | a private company wiki     |
| `closed` | nobody; an admin creates accounts, or an IdP pushes them         | a wiki fed entirely by SSO |

```sh
SIGNUP_MODE=invite
# Optional: restrict to your own mail domains. Matched exactly and
# case-insensitively — example.com does NOT cover sub.example.com.
SIGNUP_ALLOWED_EMAIL_DOMAINS=example.com,example.org
# Optional: no sign-in until the address is confirmed. Needs SMTP.
REQUIRE_EMAIL_VERIFICATION=true
```

What this does and does not cover:

- Enforcement is in the auth layer, on `/sign-up/email` — a request straight at
  the endpoint is refused, not merely hidden in the UI. The sign-in page also
  stops offering a "Registrieren" link once the mode is `closed`.
- `INITIAL_ADMIN_EMAIL` is exempt in every mode. Without that exemption a fresh
  instance set to `closed` could never be bootstrapped: no account, and
  therefore no admin who could reopen registration.
- **SSO sign-in and SCIM directory sync are unaffected.** Both are configured by
  an administrator, and that configuration is itself the invitation. Closing
  registration must not break enterprise sign-in.
- The domain allowlist bounds _self-service registration only_. An invitation to
  an address outside the list is still honoured, because somebody with the
  authority to invite deliberately sent it.
- `REQUIRE_EMAIL_VERIFICATION=true` without `SMTP_HOST` **refuses to start**.
  The alternative is worse: every new account is created and then locked out,
  with nothing in the logs pointing at the cause.

## The first instance admin

The admin console at `/admin` (accounts, sessions, instance health, support
impersonation) is gated on an **instance role**, stored in `user.role`. Nothing
sets that role at registration, so on a fresh install nobody can open it — the
first admin has to be named from outside the app.

Set `INITIAL_ADMIN_EMAIL` in `.env`:

```sh
INITIAL_ADMIN_EMAIL=admin@example.com
```

The server promotes that address on every start, and stamps the role at
registration if the account does not exist yet — so it works whether you set it
before or after signing up. Both paths are idempotent, and an account that is
already an admin is never touched.

Further admins are appointed inside the console (**Instanz-Verwaltung →
Benutzer → Zum Admin machen**). Pointing `INITIAL_ADMIN_EMAIL` at someone else
later promotes them; it never demotes anyone. The last remaining instance admin
cannot be demoted, banned or deleted.

> The chosen approach is deliberate: the alternative — "the first account to
> register becomes admin" — is a race on any instance that is reachable before
> the operator gets around to registering.

**Instance admin is not org admin.** An instance admin operates the deployment
and is not a member of any organization; an org owner has no rights here at
all. The console shows metadata only — never page content. See
[docs/permissions.md](docs/permissions.md#instance-admin-vs-org-admin).

### Impersonation

For support cases an instance admin can work as another user. It is bounded and
audited:

- A banner is visible across the whole app for as long as it lasts, with a
  one-click exit.
- The session expires on its own after `IMPERSONATION_MAX_MINUTES` (default 30).
- Start and end are written to the instance audit log with both identities, and
  mirrored into the impersonated person's own activity feed.
- Writes made during the session carry both the impersonated user and the real
  admin.
- Other instance admins cannot be impersonated.

Operators who must be able to rule the capability out entirely:

```sh
IMPERSONATION_ENABLED=false
```

This is enforced in the auth layer — a request straight to the auth endpoint is
refused, not just hidden in the UI.

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

## Bundled notifications (digests)

Instead of a mail per change, each member gets one summary per period. An
organization admin sets the defaults under **Einstellungen → Organisation →
Benachrichtigungen** (rhythm, time, time zone, which content, how much of the
wiki); every member can override them for themselves under **Einstellungen →
Benachrichtigungen**, unless the admin turns overrides off.

Operationally there is nothing to install — the `server` container runs the
schedule itself. Two things matter:

- **SMTP must be configured**, or nothing is delivered. This is safe to fix
  later: while `SMTP_HOST` is unset the runner claims no work and moves no
  cursor, so the first digest after configuring mail still reports everything
  since each member was onboarded.
- **Access is re-checked at send time**, not at write time. A digest never lists
  a space or page the recipient cannot open at the moment the mail goes out.
- **Unpublished pages stay out.** A page that has never been published is only
  reported to its own author; for everyone else it appears in the digest when it
  is published, under "Neue Seiten".

| Variable                   | Default | Purpose                                                     |
| -------------------------- | ------- | ----------------------------------------------------------- |
| `DIGEST_SCHEDULER_ENABLED` | `true`  | In-process ticker. Turn off for serverless or external cron |
| `DIGEST_TICK_SECONDS`      | `300`   | How often to look for due digests (minimum 30)              |
| `INTERNAL_RUN_TOKEN`       | unset   | Enables the `/internal/**` runner endpoints; unset = off    |

### Driving it from an external scheduler

Where the process is not long-lived, or where several replicas run and only one
scheduler should own the cadence, set `DIGEST_SCHEDULER_ENABLED=false`, generate
a token (`openssl rand -base64 32`) and call the endpoint on your own schedule:

```sh
curl -X POST https://api.example.com/internal/digests/run \
  -H "Authorization: Bearer $INTERNAL_RUN_TOKEN"
```

> `INTERNAL_RUN_TOKEN` guards every `/internal/…/run` endpoint, not just this
> one. The older `DIGEST_RUN_TOKEN` is still accepted as an alias, so existing
> deployments keep working — set the new name for anything added from here on.

The runner claims its work in the database, so calling it from several places —
or leaving the ticker on as well — cannot send anything twice. A call that
arrives while a run is in progress returns `202` and does nothing.

## Outbound webhooks

Organization admins wire events to Slack, Teams, Jira or their own automation
under **Einstellungen → Organisation → Webhooks**. Nothing needs installing: the
`server` container drains the delivery queue in-process. The payload, headers and
signature contract are documented under **Concepts → Webhooks**; operationally:

| Variable                      | Default | Purpose                                                          |
| ----------------------------- | ------- | ---------------------------------------------------------------- |
| `WEBHOOK_SCHEDULER_ENABLED`   | `true`  | In-process runner. Turn off for serverless or external cron      |
| `WEBHOOK_TICK_SECONDS`        | `30`    | How often to look for queued deliveries (minimum 5)              |
| `WEBHOOK_TIMEOUT_SECONDS`     | `10`    | Per-request timeout — a stalled receiver must not hold the batch |
| `WEBHOOK_MAX_ATTEMPTS`        | `6`     | Attempts (backoff from 1 min) before a delivery is `failed`      |
| `WEBHOOK_ALLOW_PRIVATE_HOSTS` | `false` | Allow endpoints inside the private network                       |

External scheduler, same shape as the digests:

```sh
curl -X POST https://api.example.com/internal/webhooks/run \
  -H "Authorization: Bearer $INTERNAL_RUN_TOKEN"
```

Deliveries are **claimed in the database**, so the ticker and an external cron
may both be active without anything being sent twice.

Endpoints pointing into the private network (`localhost`, `10.x`, `192.168.x`,
the cloud metadata address) are refused — on a shared instance that would let an
org admin reach hosts they otherwise cannot. Set
`WEBHOOK_ALLOW_PRIVATE_HOSTS=true` only where the receiver genuinely lives on the
internal network and every org admin is trusted with it.

## Which data lives how long

Three windows govern how long anything survives in this install. Two are per
organization and set in the app under **Einstellungen → Daten & Fristen**; the
third is deletion blocks, which override both.

| Data                                | Default retention | Where it is configured                      |
| ----------------------------------- | ----------------- | ------------------------------------------- |
| Pages, revisions, comments, uploads | forever           | not time-limited; deleting is a user action |
| Activity log / audit rows           | **unbegrenzt**    | Einstellungen → Daten & Fristen             |
| Deleted pages and spaces (trash)    | **30 Tage**       | Einstellungen → Daten & Fristen             |
| Attachments of a purged page        | removed with it   | follows the trash window                    |

The defaults keep everything. Nothing in an upgrade shortens them, and no
environment variable can: the windows are organization settings, so a deletion
policy is always an act by a named administrator, recorded in the audit log.

Four audit actions are exempt from the audit window whatever it is set to —
`retention.updated`, `retention.purged`, `hold.created`, `hold.released`. Without
that, shortening the window to a week would erase, a week later, the only record
of who shortened it.

**Deletion blocks (Löschsperren)** outrank every window. A block on a page, a
space or the whole organization prevents deletion by the runner _and_ by a user,
and covers everything beneath it — pages, comments, attachments and the audit
rows pointing at them. Setting and lifting are separate audited events, each with
a mandatory reason, and neither can be removed by a retention window.

### Operating the retention runner

Nothing to install — the `server` container runs it. It sweeps expired audit rows
and expired trash in one job, in batches with a ceiling per run, so a first run
against a log that has grown unbounded for a year does not lock the database.
Whatever is left over is picked up by the next tick.

| Variable                      | Default | Purpose                                                     |
| ----------------------------- | ------- | ----------------------------------------------------------- |
| `RETENTION_SCHEDULER_ENABLED` | `true`  | In-process ticker. Turn off for serverless or external cron |
| `RETENTION_TICK_SECONDS`      | `3600`  | How often to sweep (minimum 60)                             |
| `RETENTION_BATCH_LIMIT`       | `1000`  | Rows removed per category per run                           |

```sh
curl -X POST https://api.example.com/internal/retention/run \
  -H "Authorization: Bearer $INTERNAL_RUN_TOKEN"
```

Each organization is claimed in the database for the duration of a run, so
overlapping ticks and multiple replicas cannot delete the same rows twice; the
loser skips the organization rather than waiting. A crashed run's claim expires
after 15 minutes so it cannot freeze a tenant.

Every run that removed something logs a count per category
(`source: "retention"`), and writes one audit row per affected organization —
so "what did the job remove last night?" is answerable from the logs and from
inside the app.

Retention deliberately does not reach into **backups**. A dump taken before a
purge still contains the purged rows, and a deletion block does not protect
anything inside an archive either. Aligning backup rotation with these windows is
a separate decision — see [Backups](#backups).

### Personal data and self-hoster obligations

Which of this is _personal_ data, where it can leave the instance, how to answer
an access or erasure request, and what the software cannot do for you, are in
[docs/privacy.md](docs/privacy.md). The short version an operator needs to hold
on to: there is no telemetry, everything stays on your host except mail, webhooks
and offsite backups — all three of which you configure — and a retention purge
deliberately does not reach into backups.

## Backups

Two things need backing up, and they only mean something together: **Postgres**
(pages, revisions, Yjs snapshots, users, and all attachment _metadata_) and the
**object store** (the attachment bytes). A database dump alone restores a wiki
whose attachments all 404.

The backup service therefore produces one **recovery set** per run — both
halves, one timestamp, checksums over everything:

```
/backups/2026-08-06T030000Z/database.dump        pg_dump -Fc
/backups/2026-08-06T030000Z/attachments.tar.gz   every object in the bucket
/backups/2026-08-06T030000Z/SHA256SUMS
/backups/2026-08-06T030000Z/MANIFEST.json
/backups/last-success                            epoch seconds — the health signal
```

Attachments are mirrored **through the S3 API**, so nothing has to be stopped
for a backup to be consistent — the old "stop RustFS and tar its volume"
procedure is no longer needed.

### Turning it on

```sh
docker compose --profile backup up -d --build backup
```

`--build` because the image needs both `pg_dump` and `mc`, which no single
published image carries; it is built from `scripts/backup/Dockerfile`.

Defaults: daily, 14 days of local retention, no encryption, no offsite copy.
All four are `.env` settings — see the **Backups** block in `.env.example`.

### Recommended production settings

```sh
BACKUP_PASSPHRASE=…                  # store this OFF this host
BACKUP_REMOTE_ENDPOINT=https://s3.eu-central-1.amazonaws.com
BACKUP_REMOTE_BUCKET=my-wiki-backups
BACKUP_REMOTE_ACCESS_KEY_ID=…
BACKUP_REMOTE_SECRET_ACCESS_KEY=…
```

Two things about the offsite copy are deliberate:

- It is `mc cp`, not `mc mirror`. Mirroring would propagate local pruning to the
  remote, so a host that deletes its backups — or an attacker on it — would
  delete the only remaining copies too. **Retention on the remote belongs to the
  remote's own lifecycle policy**, where this host cannot reach it.
- Give the offsite credentials write-but-not-delete rights for the same reason.

A passphrase nobody wrote down turns a backup into a very thorough deletion.
Store it with your password manager, not on the server it protects.

### Knowing the backups still happen

The failure that costs you the wiki is the quiet one: the loop keeps running,
`docker compose ps` keeps saying **Up**, and the dumps stopped three weeks ago
because the volume filled up or a credential rotated.

`last-success` is written only after a _complete_ run — checksums, offsite copy
and all — and the container's healthcheck turns its age into container health:

```sh
docker compose ps backup     # "(healthy)" / "(unhealthy)"
```

Alert on that container state. Anything already watching Docker health (Uptime
Kuma, Prometheus + cAdvisor, a five-line cron) is enough; the point is that the
signal exists at all.

### RPO and RTO

The defaults give you:

|                              | Default                                                | Set by                    |
| ---------------------------- | ------------------------------------------------------ | ------------------------- |
| **RPO** (data you can lose)  | up to 24 h                                             | `BACKUP_INTERVAL_SECONDS` |
| **RTO** (time to be back up) | minutes to an hour, dominated by restoring attachments | size of your object store |

Tighten the RPO by lowering `BACKUP_INTERVAL_SECONDS` (e.g. `21600` for every
six hours). Each run is a full dump, not an incremental one, so the cost of a
tighter RPO is disk and CPU, not complexity.

**Write down which you are promising your users**, because these numbers are
what "we have backups" actually means to them.

### Restoring

```sh
# What is available?
docker compose --profile backup run --rm backup ls /backups

# Check a set is intact without writing anything
docker compose --profile backup run --rm backup verify /backups/2026-08-06T030000Z

# Restore it
docker compose stop web server collab
docker compose --profile backup run --rm backup restore /backups/2026-08-06T030000Z
docker compose up -d
```

The restore verifies checksums **before** writing anything, and refuses to
restore into a database that already has tables — a restore is not an import,
and silently merging a dump into live data produces a wiki that is neither the
backup nor what was there before. To deliberately replace an existing database,
add `-e RESTORE_FORCE=true`, which drops and recreates its schemas first.

Restoring from an encrypted set needs `BACKUP_PASSPHRASE` set in `.env`.

### Test the restore. On a schedule.

A backup nobody has restored is a hypothesis.

CI runs a full backup-and-restore against a real stack on every change
(`.github/workflows/smoke.yml`), which proves the _mechanism_ works. It does not
prove **your** backups are restorable — only your data and your credentials can
do that. Once a quarter:

1. Copy the newest recovery set to a scratch host.
2. `docker compose up -d postgres rustfs rustfs-init` on an empty volume set.
3. Run the restore above.
4. Start the stack, sign in, open a page **and download an attachment** — that
   last step is what catches a database-only backup.
5. Note how long it took. That is your real RTO.

Keep the `.env` file (especially `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `BACKUP_PASSPHRASE`) with your
backups — sessions and collab tokens are signed with it, and RustFS needs the
original credentials.

### Manual dumps

For a one-off, outside the backup service:

```sh
docker compose stop web server collab
docker exec nilovon-wiki-postgres pg_dump -U postgres -Fc nilovon-wiki > backup-$(date +%F).dump
docker compose up -d
```

This covers the database only. If you take a manual dump, take the matching
attachments too — `docker compose --profile backup run --rm backup run` does
both and is almost always the better answer.

### Retention interacts with backups

Per-organization retention windows (audit log, trash) deliberately do **not**
reach into backups: a dump taken before a purge still contains the rows that
purge removed. That is the point of a backup, and it is also a data-protection
fact you have to state — see
[Which data lives how long](#which-data-lives-how-long) and
[docs/privacy.md](docs/privacy.md).

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

## PDF export

PDF exports need no extra service: they are rendered inside the API process, so
there is no headless browser, no additional container and no change to the
Compose file or the installer. The cost lands on the API's CPU instead, bounded
by three optional variables:

```env
PDF_EXPORT_MAX_PAGES=500         # pages rendered per Space export
PDF_EXPORT_PAGE_TIMEOUT_MS=15000 # wall-clock budget per page
PDF_EXPORT_IMAGE_CACHE_MB=64     # per-export image cache ceiling
```

Pages render one at a time, so peak memory stays at roughly one page regardless
of Space size. Raise `PDF_EXPORT_MAX_PAGES` if your largest Space exceeds it —
pages past the ceiling are not dropped, but they do come out as placeholders.
See `docs/export-format.md`.

## Health & monitoring

Three endpoints, because an orchestrator and a monitoring system are asking
different questions. None of them needs authentication, and none returns tenant
data or a version number.

| Endpoint            | Answers                      | Fails (503) when                           |
| ------------------- | ---------------------------- | ------------------------------------------ |
| `GET /health/live`  | is the process alive?        | never — it touches nothing                 |
| `GET /health`       | can the process serve?       | the database is unreachable                |
| `GET /health/ready` | is every dependency healthy? | any _configured_ dependency is unreachable |

`/health` is what the compose healthcheck and any orchestrator watch, and it is
narrow on purpose: object storage or the collaboration service failing does not
make restarting the API the right answer, and a restart loop is worse than
degraded attachments.

**Point your monitoring at `/health/ready`.** It probes the database, object
storage and the collaboration service concurrently and reports each one:

```jsonc
{
  "status": "degraded",
  "checks": {
    "database": { "status": "ok" },
    "storage": { "status": "unreachable", "detail": "no such bucket" },
    "collab": { "status": "ok" },
    "mail": { "status": "disabled" },
  },
}
```

`disabled` means the dependency is not configured on this install (attachments
or mail turned off), which is a supported configuration and not an outage.
`ok` for mail means SMTP is configured — there is no cheap probe short of an
actual SMTP dialogue, and the report says "configured" rather than pretending to
have tested it.

`/health/ready` is rate-limited (60/min per IP) because each call opens a
connection to storage and to collab. `/health` and `/health/live` are not: a
probe that starts getting 429s during an incident is worse than useless.

A minimal alerting rule set:

- `/health` non-200 for 2 minutes → the API cannot serve. Page.
- `/health/ready` reporting `storage: unreachable` → attachments and exports are
  broken; page during working hours.
- `/health/ready` reporting `collab: unreachable` → collaborative editing is
  down; pages still load and save. Page during working hours.
- Backup age above your RPO → see [Backups](#backups); the backup container's
  own healthcheck already turns this into a container state.

Container logs are JSON-file capped at 10 MB × 3 files per service.
