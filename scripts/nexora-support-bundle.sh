#!/bin/bash
# nexora-support-bundle.sh — collect a redacted diagnostics tarball the
# operator can send to the maintainer without leaking secrets.
# Bundles:
#   - docker compose ps / config (no env values)
#   - docker compose logs (last 500 lines per service)
#   - GET /api/admin/system/health (if cookie provided)
#   - .env / Caddyfile (REDACTED — values replaced with ***REDACTED***)
#   - host info (uname, docker version)
#
# Usage:
#   ./scripts/nexora-support-bundle.sh
#   ./scripts/nexora-support-bundle.sh --cookie "sid=abc123"  # for /system/health
#
# Output: ./nexora-support-YYYY-MM-DD_HHMMSS.tar.gz

set -euo pipefail

STAMP="$(date +%Y-%m-%d_%H%M%S)"
WORK="$(mktemp -d)"
OUT_DIR="$WORK/bundle"
mkdir -p "$OUT_DIR"
trap 'rm -rf "$WORK"' EXIT

ADMIN_COOKIE=""
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/admin/system/health}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cookie) ADMIN_COOKIE="$2"; shift 2 ;;
    --compose) COMPOSE_FILE="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    *) echo "[support-bundle] unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Redactor: replace every right-hand-side of KEY=value with stars, AND any
# bare-looking hex/base64 secret of suspicious length. Conservative: false
# positives are fine, false negatives are not.
redact() {
  sed -E \
    -e 's/(PASSWORD|SECRET|TOKEN|KEY|API|XPUB|HASH|HMAC|PRIVATE|SIGNING|COOKIE|SESSION)([A-Z_]*)[[:space:]]*=[[:space:]]*[^[:space:]]+/\1\2=***REDACTED***/Ig' \
    -e 's/(Bearer|Basic)[[:space:]]+[A-Za-z0-9._/+=-]+/\1 ***REDACTED***/g' \
    -e 's/\b[A-Fa-f0-9]{40,}\b/***REDACTED_HEX***/g'
}

echo "[support-bundle] collecting host info..."
{
  echo "=== uname -a ==="; uname -a || true
  echo "=== docker version ==="; docker version --format '{{.Server.Version}}' 2>&1 || true
  echo "=== date ==="; date -u
} > "$OUT_DIR/host.txt"

echo "[support-bundle] collecting compose state..."
docker compose -f "$COMPOSE_FILE" ps > "$OUT_DIR/compose-ps.txt" 2>&1 || true
# `config` resolves env into values — redact before saving.
docker compose -f "$COMPOSE_FILE" config 2>&1 | redact > "$OUT_DIR/compose-config.yml" || true

echo "[support-bundle] collecting last 500 log lines per service..."
for svc in caddy backend frontend; do
  docker compose -f "$COMPOSE_FILE" logs --tail=500 --no-color "$svc" 2>&1 \
    | redact > "$OUT_DIR/log-${svc}.txt" || true
done

if [ -n "$ADMIN_COOKIE" ]; then
  echo "[support-bundle] querying /api/admin/system/health..."
  curl -s --max-time 10 -H "Cookie: $ADMIN_COOKIE" "$HEALTH_URL" \
    | redact > "$OUT_DIR/system-health.json" 2>&1 || \
    echo "(curl failed)" > "$OUT_DIR/system-health.json"
else
  echo "(no --cookie passed; skipped)" > "$OUT_DIR/system-health.json"
fi

# Redact any local env / config files if they exist next to the compose.
for f in .env backend/.env Caddyfile; do
  if [ -f "$f" ]; then
    redact < "$f" > "$OUT_DIR/$(echo "$f" | tr '/' '_').redacted"
  fi
done

OUT="nexora-support-${STAMP}.tar.gz"
tar -czf "$OUT" -C "$WORK" bundle
SIZE=$(du -h "$OUT" | cut -f1)
echo "[support-bundle] wrote $OUT (${SIZE})"
echo "[support-bundle] inspect before sending: tar -tzf $OUT"