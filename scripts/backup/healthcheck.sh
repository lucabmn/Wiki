#!/bin/sh
# Turns backup *age* into container health.
#
# The failure this exists for is the quiet one: the backup loop keeps running,
# `docker compose ps` keeps saying "Up", and the dumps stopped three weeks ago
# because the volume filled up or a credential rotated. Nobody finds out until a
# restore is needed. An unhealthy container is visible in `docker compose ps`,
# in `docker events`, and to anything already watching container state.
#
# `last-success` is written by backup.sh only after a complete run — checksums,
# offsite copy and all — so a partial backup never refreshes it.
set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
MARKER="$BACKUP_ROOT/last-success"
# Default: a day and a half. The loop runs daily, so this tolerates one slow or
# skipped run and flags the second — early enough to fix, late enough not to
# page over a backup that merely started an hour late.
MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-129600}"

if [ ! -f "$MARKER" ]; then
  # A container that has never completed a backup is *not* healthy — it is a
  # backup service that has never backed anything up. The start_period in the
  # compose healthcheck covers the legitimate window before the first run.
  echo "no successful backup yet ($MARKER missing)" >&2
  exit 1
fi

now=$(date -u +%s)
last=$(cat "$MARKER")
age=$((now - last))

if [ "$age" -gt "$MAX_AGE_SECONDS" ]; then
  echo "last successful backup was ${age}s ago (limit ${MAX_AGE_SECONDS}s)" >&2
  exit 1
fi

echo "last successful backup ${age}s ago"
