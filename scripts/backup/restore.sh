#!/bin/sh
# Restores one recovery set produced by backup.sh.
#
#   docker compose --profile backup run --rm backup restore /backups/<stamp>
#
# A backup nobody has restored is a hypothesis. This script exists so the
# restore is a single documented command rather than a sequence somebody has to
# reconstruct under pressure — and so CI can run it on every change
# (.github/workflows/smoke.yml).
#
# It refuses to write into a database that already has application tables. A
# restore is not an import: silently merging a dump into live data produces a
# wiki that is neither the backup nor what was there before.
set -eu

SET_DIR="${1:-}"
[ -n "$SET_DIR" ] || {
  echo "usage: restore.sh /backups/<timestamp>" >&2
  exit 2
}
[ -d "$SET_DIR" ] || {
  echo "no such recovery set: $SET_DIR" >&2
  exit 2
}

PGHOST="${POSTGRES_HOST:-postgres}"
PGUSER="${POSTGRES_USER:-postgres}"
PGDATABASE="${POSTGRES_DB:-nilovon-wiki}"

log() { echo "[restore] $*"; }
fail() {
  echo "[restore] FAILED: $*" >&2
  exit 1
}

# ── 1. Integrity ──────────────────────────────────────────────────────────────
# Before anything is written, not after. Restoring a corrupt dump over an empty
# database leaves you with neither a wiki nor a backup you still trust.
log "verifying checksums"
[ -f "$SET_DIR/SHA256SUMS" ] || fail "no SHA256SUMS in $SET_DIR"
(cd "$SET_DIR" && sha256sum -c SHA256SUMS) || fail "checksum mismatch — this set is corrupt"

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ── 2. Decryption ─────────────────────────────────────────────────────────────
DB_DUMP="$SET_DIR/database.dump"
ATTACHMENTS="$SET_DIR/attachments.tar.gz"
if [ -f "$SET_DIR/database.dump.enc" ]; then
  [ -n "${BACKUP_PASSPHRASE:-}" ] || fail "this set is encrypted; set BACKUP_PASSPHRASE"
  log "decrypting"
  for file in "$SET_DIR"/*.enc; do
    plain="$WORK/$(basename "${file%.enc}")"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
      -pass env:BACKUP_PASSPHRASE -in "$file" -out "$plain" ||
      fail "decryption failed — wrong passphrase?"
  done
  DB_DUMP="$WORK/database.dump"
  ATTACHMENTS="$WORK/attachments.tar.gz"
fi
[ -f "$DB_DUMP" ] || fail "no database dump in $SET_DIR"

# ── 3. Refuse to overwrite a populated database ───────────────────────────────
existing=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "select count(*) from information_schema.tables where table_schema in ('public','auth','wiki')" \
  2>/dev/null || echo "unreachable")
[ "$existing" != "unreachable" ] || fail "cannot reach postgres at $PGHOST"
if [ "$existing" != "0" ] && [ "${RESTORE_FORCE:-}" != "true" ]; then
  fail "database '$PGDATABASE' already has $existing tables. Restore into an empty database, or set RESTORE_FORCE=true to drop and recreate its schemas first."
fi

if [ "${RESTORE_FORCE:-}" = "true" ] && [ "$existing" != "0" ]; then
  log "dropping existing schemas (RESTORE_FORCE=true)"
  # Every non-system schema, discovered rather than listed. A hand-written list
  # is wrong the moment a schema is added: the first version named `wiki`,
  # `auth`, `admin` and `public`, forgot `drizzle` (the migration bookkeeping),
  # and `pg_restore` then aborted on `schema "drizzle" already exists` — after
  # it had already dropped everything else.
  psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c "
    DO \$\$
    DECLARE target text;
    BEGIN
      FOR target IN
        -- Everything Postgres does not own. The 'pg_' prefix is reserved for
        -- system schemas, which covers pg_catalog, pg_toast and every
        -- pg_temp_* / pg_toast_temp_* in one predicate.
        SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
          AND nspname <> 'information_schema'
      LOOP
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', target);
      END LOOP;
    END
    \$\$;
    CREATE SCHEMA IF NOT EXISTS public;
  " || fail "could not clear the target database"
fi

# ── 4. Database ───────────────────────────────────────────────────────────────
log "restoring database"
# `--exit-on-error` is what makes this a restore rather than a best-effort
# import: without it pg_restore reports success after skipping every object it
# could not create, and the wiki comes up subtly incomplete.
pg_restore \
  --host "$PGHOST" \
  --username "$PGUSER" \
  --dbname "$PGDATABASE" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$DB_DUMP" >/dev/null || fail "pg_restore"

# ── 5. Attachments ────────────────────────────────────────────────────────────
# Restored *after* the database, so an object store that is briefly ahead of the
# database is the harmless direction: extra bytes nobody references yet.
if [ -f "$ATTACHMENTS" ] && [ -n "${S3_ENDPOINT:-}" ]; then
  log "restoring attachments"
  mkdir -p "$WORK/objects"
  tar xzf "$ATTACHMENTS" -C "$WORK/objects" || fail "tar extract"
  mc alias set restoredst "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null ||
    fail "cannot reach object storage at $S3_ENDPOINT"
  mc mb --ignore-existing "restoredst/${S3_BUCKET:-nilovon-wiki}" >/dev/null
  mc mirror --quiet --overwrite "$WORK/objects" "restoredst/${S3_BUCKET:-nilovon-wiki}" ||
    fail "mc mirror"
elif [ -f "$ATTACHMENTS" ]; then
  log "attachments present in the set but S3_ENDPOINT is unset — skipped"
fi

log "restore complete. Start the stack and verify: sign in, open a page, download an attachment."
