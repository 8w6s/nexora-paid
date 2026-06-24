#!/bin/bash
# nexora-restore-drill.sh — read-only restore drill. Validates that a backup
# from `nexora-backup.sh` can actually be opened AND contains the schema +
# row counts a real Nexora DB should have. Does NOT touch the live volume.
#
# Usage:
#   ./scripts/nexora-restore-drill.sh /var/backups/nexora/db-2026-06-23_120000.db
#
# Exit codes:
#   0  PASS — backup is readable and looks like a real Nexora DB.
#   1  FATAL — argument / file missing.
#   2  FAIL — backup unreadable or wrong schema.
#   3  FAIL — schema OK but obviously empty (no users, no products).
#
# Run quarterly (per RELEASE_CHECKLIST §7) and after every restore-procedure
# change. A backup nobody has opened is not a backup.

set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "[restore-drill] FATAL: usage: $0 <backup-file.db>" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore-drill] FATAL: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# Restore to a scratch path so we never touch the live DB.
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
TARGET="$SCRATCH/restore.db"

# `cp` is fine here — we are reading a static snapshot, not a live DB. The
# WAL-safety concern only applies to the live writer.
cp "$BACKUP_FILE" "$TARGET"

# 1) Does it open at all?
if ! sqlite3 "$TARGET" "SELECT count(*) FROM sqlite_master;" >/dev/null 2>&1; then
  echo "[restore-drill] FAIL: backup file is not a valid SQLite database" >&2
  exit 2
fi

# 2) Does it have the tables a real Nexora DB has? Check a representative
# subset — not every table, because schema evolves; these 5 are core and
# have been present since v0.1.
EXPECTED_TABLES=(users products orders product_keys settings)
MISSING=()
for table in "${EXPECTED_TABLES[@]}"; do
  if ! sqlite3 "$TARGET" "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';" \
       | grep -q "^${table}$"; then
    MISSING+=("$table")
  fi
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "[restore-drill] FAIL: missing core tables: ${MISSING[*]}" >&2
  exit 2
fi

# 3) Sanity counts. An empty DB passes (1) and (2) but is clearly not a real
# customer backup. Bail at 3 so the operator notices fresh-install snapshots
# being archived by mistake.
USERS=$(sqlite3 "$TARGET" "SELECT count(*) FROM users;")
PRODUCTS=$(sqlite3 "$TARGET" "SELECT count(*) FROM products;")
ORDERS=$(sqlite3 "$TARGET" "SELECT count(*) FROM orders;")

if [ "$USERS" -eq 0 ] && [ "$PRODUCTS" -eq 0 ] && [ "$ORDERS" -eq 0 ]; then
  echo "[restore-drill] FAIL: backup opens but has 0 users / 0 products / 0 orders — looks like a fresh-install snapshot, not a real customer DB" >&2
  exit 3
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[restore-drill] PASS ${BACKUP_FILE} (size=${SIZE}, users=${USERS}, products=${PRODUCTS}, orders=${ORDERS})"