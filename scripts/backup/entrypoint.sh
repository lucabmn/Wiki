#!/bin/sh
# Container entrypoint for the backup service.
#
#   (no argument)         run backup.sh on a loop, forever
#   run                   run backup.sh exactly once and exit
#   restore <set>         restore one recovery set
#   verify <set>          check a set's checksums without writing anything
#
# A sleep loop rather than cron: one process, logs on stdout like every other
# service, and no second scheduler to keep alive inside the image.
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

case "${1:-loop}" in
  run)
    exec /usr/local/bin/backup.sh
    ;;
  restore)
    shift
    exec /usr/local/bin/restore.sh "$@"
    ;;
  verify)
    shift
    set_dir="${1:?usage: verify /backups/<timestamp>}"
    cd "$set_dir"
    exec sha256sum -c SHA256SUMS
    ;;
  loop)
    # The first run happens immediately rather than after a full interval, so a
    # freshly started service is protected from minute one — and a broken
    # configuration surfaces now instead of tomorrow night.
    while true; do
      # `|| true`: one failing run must not end the loop. It already logged the
      # reason, and the health signal it did *not* refresh is what raises the
      # alarm — a dead container would look the same as a stopped profile.
      /usr/local/bin/backup.sh || true
      sleep "$INTERVAL"
    done
    ;;
  *)
    exec "$@"
    ;;
esac
