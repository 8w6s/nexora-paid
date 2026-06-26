#!/usr/bin/env bash
# Re-sync the frontend locale dictionaries into the backend image source tree.
# Run this whenever a key is added/edited in frontend/src/i18n/locales — the
# backend image carries its own copy under backend/src/lib/locales so the
# Docker build does not have to reach out of its build context.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend/src/i18n/locales"
DST="$ROOT/backend/src/lib/locales"

mkdir -p "$DST"
cp "$SRC"/de.json "$SRC"/en.json "$SRC"/es.json "$SRC"/vi.json "$SRC"/zh.json "$DST/"

echo "Synced 5 locales from $SRC → $DST"