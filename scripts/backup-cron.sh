#!/bin/sh
# Lightweight backup cron — runs inside Docker as a sidecar container.
# Takes an atomic SQLite backup every $BACKUP_INTERVAL_HOURS hours,
# retains $RETENTION_DAYS days of snapshots, logs to stdout.
#
# Used by docker-compose.yml "backup" service (optional profile).

set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nexora}"
DB_PATH="${DB_PATH:-/app/data/sqlite.db}"
INTERVAL="${BACKUP_INTERVAL_HOURS:-6}"
RETENTION="${RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

echo "[backup] Started. interval=${INTERVAL}h retention=${RETENTION}d db=${DB_PATH} dir=${BACKUP_DIR}"

while true; do
  STAMP="$(date +%Y-%m-%d_%H%M%S)"
  DEST="$BACKUP_DIR/db-${STAMP}.db"

  if [ ! -f "$DB_PATH" ]; then
    echo "[backup] WARN: DB file not found at $DB_PATH — skipping this cycle"
    sleep $((INTERVAL * 3600))
    continue
  fi

  # Use sqlite3 .backup for WAL-safe atomic snapshot
  if sqlite3 "$DB_PATH" ".backup '$DEST'" 2>&1; then
    SIZE=$(du -h "$DEST" | cut -f1)
    echo "[backup] OK: $DEST ($SIZE)"
  else
    echo "[backup] FAIL: sqlite3 .backup returned $?"
    rm -f "$DEST"
    sleep $((INTERVAL * 3600))
    continue
  fi

  # Verify snapshot opens
  if sqlite3 "$DEST" "SELECT count(*) FROM sqlite_master;" >/dev/null 2>&1; then
    echo "[backup] Verified: snapshot opens cleanly"
  else
    echo "[backup] WARN: snapshot failed verification — keeping but flagging"
    mv "$DEST" "${DEST}.BAD"
  fi

  # Prune old backups
  CUTOFF=$(find "$BACKUP_DIR" -name "db-*.db" -mtime +"$RETENTION" | wc -l)
  if [ "$CUTOFF" -gt 0 ]; then
    find "$BACKUP_DIR" -name "db-*.db" -mtime +"$RETENTION" -delete
    echo "[backup] Pruned $CUTOFF old snapshot(s) older than ${RETENTION}d"
  fi

  sleep $((INTERVAL * 3600))
done