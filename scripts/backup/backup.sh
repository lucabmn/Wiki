#!/bin/sh
# One backup run = one restorable recovery set.
#
# The database alone restores a wiki whose attachments all 404, so a run always
# produces both halves, under one timestamp, with checksums over everything:
#
#   /backups/<UTC timestamp>/database.dump       pg_dump -Fc (compressed)
#   /backups/<UTC timestamp>/attachments.tar.gz  every object in the bucket
#   /backups/<UTC timestamp>/SHA256SUMS          checksums of both
#   /backups/<UTC timestamp>/MANIFEST.json       what this set is and how to read it
#   /backups/last-success                        epoch seconds — the health signal
#
# Ordering is deliberate: the database is dumped *first*, then the object store
# is mirrored. An object uploaded between the two steps is merely extra and
# harmless, whereas the reverse order would produce a dump referencing bytes the
# mirror never captured.
#
# The mirror reads through the S3 API, so — unlike archiving the raw RustFS
# volume — nothing has to be stopped for a backup to be consistent.
set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
# Written under `.part` and renamed only on success, so a crashed or killed run
# can never leave something that looks like a complete recovery set.
STAGING="$DEST.part"

log() { echo "[backup] $*"; }
fail() {
  echo "[backup] FAILED: $*" >&2
  rm -rf "$STAGING"
  exit 1
}

mkdir -p "$STAGING"

# ── 1. Database ───────────────────────────────────────────────────────────────
log "dumping database"
# `-Fc` (custom format) rather than plain SQL piped through gzip. It is already
# compressed, and — the reason that matters — it needs no pipe: POSIX `sh` has
# no `pipefail`, so `pg_dump | gzip` would report gzip's exit status and write a
# truncated dump as a success.
pg_dump \
  --host "${POSTGRES_HOST:-postgres}" \
  --username "${POSTGRES_USER:-postgres}" \
  --no-password \
  --format=custom \
  --file "$STAGING/database.dump" \
  "${POSTGRES_DB:-nilovon-wiki}" || fail "pg_dump"

# Belt and braces: a dump of a migrated schema is tens of kilobytes even with no
# content in it, so anything this small means something went wrong quietly.
dump_bytes=$(wc -c <"$STAGING/database.dump")
[ "$dump_bytes" -gt 1024 ] || fail "database dump is implausibly small ($dump_bytes bytes)"

# The files that make up this recovery set, in the order they were produced.
# Everything downstream — checksums, encryption, the manifest — works off this
# list, so a new artefact is added in exactly one place.
SET_FILES="database.dump"

# ── 2. Attachments ────────────────────────────────────────────────────────────
# Skipped, not faked, where the install has no object storage — some deployments
# genuinely run without attachments, and an empty archive would misrepresent
# that as "nothing was uploaded".
HAS_ATTACHMENTS=false
if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_ACCESS_KEY_ID:-}" ]; then
  log "mirroring object storage"
  mc alias set backupsrc "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null ||
    fail "cannot reach object storage at $S3_ENDPOINT"
  rm -rf "$STAGING/objects"
  mkdir -p "$STAGING/objects"
  mc mirror --quiet --overwrite "backupsrc/${S3_BUCKET:-nilovon-wiki}" "$STAGING/objects" ||
    fail "mc mirror"
  tar czf "$STAGING/attachments.tar.gz" -C "$STAGING/objects" . || fail "tar attachments"
  rm -rf "$STAGING/objects"
  HAS_ATTACHMENTS=true
  SET_FILES="$SET_FILES attachments.tar.gz"
else
  log "object storage not configured — database only"
fi

# ── 3. Integrity ──────────────────────────────────────────────────────────────
# Checksums are what turn "the file is there" into "the file is intact". Bit rot
# on a backup volume is silent otherwise, and only shows up during the restore
# you cannot afford to have fail.
# Word-split on purpose: SET_FILES is a space-separated list this script builds
# itself, and the names contain no spaces.
# shellcheck disable=SC2086
(cd "$STAGING" && sha256sum $SET_FILES >SHA256SUMS) || fail "sha256sum"

# ── 4. Optional encryption ────────────────────────────────────────────────────
# Off by default: a passphrase nobody wrote down turns a backup into a very
# thorough deletion. Set BACKUP_PASSPHRASE only once it is stored somewhere
# other than this host — losing it loses every backup made with it.
ENCRYPTED=false
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  log "encrypting"
  ENCRYPTED=true
  encrypted_files=""
  for name in $SET_FILES; do
    openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
      -pass env:BACKUP_PASSPHRASE \
      -in "$STAGING/$name" -out "$STAGING/$name.enc" || fail "openssl enc"
    rm -f "$STAGING/$name"
    encrypted_files="$encrypted_files $name.enc"
  done
  SET_FILES="${encrypted_files# }"
  # Re-checksum the ciphertext: the plaintext sums describe files that no longer
  # exist, and a checksum file that does not match its set is worse than none.
  # shellcheck disable=SC2086
  (cd "$STAGING" && sha256sum $SET_FILES >SHA256SUMS) || fail "sha256sum (encrypted)"
fi

# ── 5. Manifest ───────────────────────────────────────────────────────────────
# So a restore six months from now does not depend on someone remembering which
# flags produced the files.
cat >"$STAGING/MANIFEST.json" <<JSON
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "${POSTGRES_DB:-nilovon-wiki}",
  "attachments": $HAS_ATTACHMENTS,
  "encrypted": $ENCRYPTED,
  "encryption": "openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt",
  "restoreWith": "scripts/backup/restore.sh"
}
JSON

mv "$STAGING" "$DEST"
log "wrote $DEST"

# ── 6. Offsite copy ───────────────────────────────────────────────────────────
# A backup on the same host survives a bad deploy and nothing else. This is the
# step that survives the host itself.
if [ -n "${BACKUP_REMOTE_ENDPOINT:-}" ] && [ -n "${BACKUP_REMOTE_BUCKET:-}" ]; then
  log "copying offsite"
  mc alias set backupdst "$BACKUP_REMOTE_ENDPOINT" \
    "${BACKUP_REMOTE_ACCESS_KEY_ID:-}" "${BACKUP_REMOTE_SECRET_ACCESS_KEY:-}" >/dev/null ||
    fail "cannot reach the offsite target"
  # `cp --recursive`, not `mirror`: mirroring would propagate local pruning to
  # the offsite copy, so a host that deletes its backups would delete the only
  # remaining ones too. Offsite retention belongs to the remote's own lifecycle
  # policy, where a compromised host cannot reach it.
  mc cp --quiet --recursive "$DEST" \
    "backupdst/$BACKUP_REMOTE_BUCKET/${BACKUP_REMOTE_PREFIX:-nilovon-wiki}/" ||
    fail "offsite copy"
  log "offsite copy done"
else
  log "no offsite target configured — backups live only on this host"
fi

# ── 7. Retention ──────────────────────────────────────────────────────────────
# Only *after* the new set landed, so a failing run never prunes the last good
# backup along with the old ones.
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_DAYS" -exec rm -rf {} + || true
# Leftovers from runs that died mid-write.
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '*.part' -mtime +1 -exec rm -rf {} + || true

# ── 8. Health signal ──────────────────────────────────────────────────────────
# Written last and only on complete success. `healthcheck.sh` turns the age of
# this file into the container's health state, so a silently failing backup
# shows up in `docker compose ps` instead of being discovered during a restore.
date -u +%s >"$BACKUP_ROOT/last-success"
log "done"
