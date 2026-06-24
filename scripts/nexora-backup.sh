#!/bin/bash
# nexora-backup.sh — atomic SQLite snapshot via the online backup API.
#
# Run from the host crontab, NOT inside the container. Snapshots persist to
# $BACKUP_DIR on the host so a `docker compose down -v` (which would wipe the
# named volume) cannot destroy your history.
#
#   crontab -e
#   0 * * * * /usr/local/bin/nexora-backup.sh >> /var/log/nexora-backup.log 2>&1
#
# Why `sqlite3 .backup` and NOT `cp sqlite.db`:
#   The backend runs SQLite in WAL mode. A bare `cp` copies only the main
#   file, missing in-flight writes in sqlite.db-wal / sqlite.db-shm. The
#   watcher commits roughly every 30s, so a copy at the wrong instant
#   snapshots a half-written transaction and the restored DB will fail to
#   open. `.backup` uses SQLite's online-backup API which is atomic with
#   respect to live writers — always use it.
#
# Override via env: BACKUP_DIR, RETENTION_DAYS, COMPOSE_FILE.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nexora}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
SNAPSHOT_NAME="db-${STAMP}.db"
CONTAINER_SNAPSHOT="/app/data/backup-${STAMP}.db"

# Resolve compose backend container id once. Bail loud if backend isn't up —
# a silent "no container" would leave the cron exit code 0 and the operator
# never knows backups stopped.
CID="$(docker compose -f "$COMPOSE_FILE" ps -q backend || true)"
if [ -z "$CID" ]; then
  echo "[nexora-backup] FATAL: backend container not running (compose file: $COMPOSE_FILE)" >&2
  exit 1
fi

# `.backup` is atomic + WAL-safe even while the watcher commits.
docker compose -f "$COMPOSE_FILE" exec -T backend \
  sqlite3 /app/data/sqlite.db ".backup '${CONTAINER_SNAPSHOT}'"

# Copy snapshot to host BEFORE removing it from the container — if the host
# copy fails, we still have the snapshot inside the volume for a manual rescue.
docker cp "${CID}:${CONTAINER_SNAPSHOT}" "${BACKUP_DIR}/${SNAPSHOT_NAME}"

# Clean up the in-container snapshot so the volume doesn't grow unbounded.
docker compose -f "$COMPOSE_FILE" exec -T backend rm "${CONTAINER_SNAPSHOT}"

# Verify the on-host snapshot is a readable SQLite file before we trust it.
# A backup that nobody has opened is not a backup.
if ! sqlite3 "${BACKUP_DIR}/${SNAPSHOT_NAME}" "SELECT count(*) FROM sqlite_master;" >/dev/null 2>&1; then
  echo "[nexora-backup] FATAL: snapshot ${SNAPSHOT_NAME} failed verify" >&2
  exit 2
fi

# Retention prune — keep N days of hourlies. Daily / monthly rotation is the
# operator's responsibility (see docs/PRODUCTION.md §5).
find "$BACKUP_DIR" -name "db-*.db" -mtime "+${RETENTION_DAYS}" -delete

echo "[nexora-backup] ok ${SNAPSHOT_NAME} ($(du -h "${BACKUP_DIR}/${SNAPSHOT_NAME}" | cut -f1))"