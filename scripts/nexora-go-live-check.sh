#!/bin/bash
# nexora-go-live-check.sh — pre-flight verdict against a running stack.
# Reads real system state (not env files alone). Prints PASS / WARN / FAIL
# per check; exits non-zero if any FAIL.
#
# Usage:
#   ./scripts/nexora-go-live-check.sh
#   ./scripts/nexora-go-live-check.sh --cookie "sid=admincookievalue"  # enables auth'd checks
#
# Companion to RELEASE_CHECKLIST.md — same intent, automated. Run after
# `docker compose up -d` on the production host, before flipping DNS.

set -uo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/admin/system/health}"
ADMIN_COOKIE=""
FAILS=0
WARNS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cookie) ADMIN_COOKIE="$2"; shift 2 ;;
    --compose) COMPOSE_FILE="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    *) echo "[go-live] unknown arg: $1" >&2; exit 2 ;;
  esac
done

pass() { echo "  [PASS] $1"; }
warn() { echo "  [WARN] $1"; WARNS=$((WARNS + 1)); }
fail() { echo "  [FAIL] $1"; FAILS=$((FAILS + 1)); }

echo "=== Stack ==="
CID=$(docker compose -f "$COMPOSE_FILE" ps -q backend 2>/dev/null || true)
if [ -z "$CID" ]; then
  fail "backend container not running (compose file: $COMPOSE_FILE)"
else
  pass "backend container running ($CID)"
  HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo "none")
  case "$HEALTH" in
    healthy) pass "backend healthcheck=healthy" ;;
    starting) warn "backend healthcheck=starting (give it 30s and re-run)" ;;
    none) warn "backend has no healthcheck configured (compose may be stale)" ;;
    *) fail "backend healthcheck=$HEALTH" ;;
  esac
fi

echo ""
echo "=== Env / config ==="
NODE_ENV_VAL=$(docker compose -f "$COMPOSE_FILE" exec -T backend printenv NODE_ENV 2>/dev/null | tr -d '\r' || echo "")
[ "$NODE_ENV_VAL" = "production" ] && pass "NODE_ENV=production" || fail "NODE_ENV='$NODE_ENV_VAL' (expected: production)"

PUBLIC_ORIGIN_VAL=$(docker compose -f "$COMPOSE_FILE" exec -T backend printenv PUBLIC_ORIGIN 2>/dev/null | tr -d '\r' || echo "")
case "$PUBLIC_ORIGIN_VAL" in
  https://*) pass "PUBLIC_ORIGIN uses HTTPS ($PUBLIC_ORIGIN_VAL)" ;;
  http://localhost*) fail "PUBLIC_ORIGIN is localhost — set to https://<domain> before go-live" ;;
  http://*) fail "PUBLIC_ORIGIN uses HTTP — production refuses non-HTTPS" ;;
  "") fail "PUBLIC_ORIGIN not set" ;;
  *) warn "PUBLIC_ORIGIN unusual: $PUBLIC_ORIGIN_VAL" ;;
esac

ORDER_SECRET_LEN=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'echo -n "${ORDER_TOKEN_SECRET:-}" | wc -c' 2>/dev/null | tr -d '\r ' || echo "0")
if [ "$ORDER_SECRET_LEN" -ge 32 ]; then
  pass "ORDER_TOKEN_SECRET length=$ORDER_SECRET_LEN (≥32)"
elif [ "$ORDER_SECRET_LEN" -gt 0 ]; then
  fail "ORDER_TOKEN_SECRET length=$ORDER_SECRET_LEN (need ≥32 chars)"
else
  fail "ORDER_TOKEN_SECRET not set"
fi

ADMIN_PW=$(docker compose -f "$COMPOSE_FILE" exec -T backend printenv ADMIN_PASSWORD 2>/dev/null | tr -d '\r' || echo "")
ADMIN_HASH=$(docker compose -f "$COMPOSE_FILE" exec -T backend printenv ADMIN_PASSWORD_HASH 2>/dev/null | tr -d '\r' || echo "")
if [ -n "$ADMIN_HASH" ]; then
  pass "ADMIN_PASSWORD_HASH set (plaintext not in env)"
elif [ "$ADMIN_PW" = "change-me" ] || [ "$ADMIN_PW" = "admin12345" ]; then
  fail "ADMIN_PASSWORD is the default '$ADMIN_PW' — rotate before go-live"
elif [ -n "$ADMIN_PW" ]; then
  warn "ADMIN_PASSWORD is plaintext — production prefers ADMIN_PASSWORD_HASH (argon2id)"
else
  fail "Neither ADMIN_PASSWORD nor ADMIN_PASSWORD_HASH set"
fi

echo ""
echo "=== Database ==="
DB_OK=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'sqlite3 /app/data/sqlite.db "SELECT 1"' 2>/dev/null | tr -d '\r ' || echo "")
if [ "$DB_OK" = "1" ]; then
  pass "sqlite.db readable"
  PRODUCTS=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'sqlite3 /app/data/sqlite.db "SELECT count(*) FROM products WHERE active=1"' 2>/dev/null | tr -d '\r ' || echo "0")
  KEYS=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'sqlite3 /app/data/sqlite.db "SELECT count(*) FROM product_keys WHERE status="available""' 2>/dev/null | tr -d '\r ' || echo "0")
  XPUB=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'sqlite3 /app/data/sqlite.db "SELECT value FROM settings WHERE key IN ("ltc_xpub","pay_crypto_ltc_xpub") LIMIT 1"' 2>/dev/null | tr -d '\r ' || echo "")
  [ "$PRODUCTS" -gt 0 ] && pass "active products=$PRODUCTS" || warn "no active products — storefront will be empty"
  [ "$KEYS" -gt 0 ] && pass "available keys=$KEYS" || warn "no available keys — checkout will return NO_STOCK"
  case "$XPUB" in
    Ltub*|Mtub*|zpub*|vpub*) pass "LTC xpub set (${XPUB:0:6}…)" ;;
    "") fail "LTC xpub not set — checkout returns NO_WALLET" ;;
    ltc1*|L*|M*) fail "LTC value is a single address, not an xpub — re-derive an Ltub/Mtub/zpub" ;;
    *) warn "LTC value present but unfamiliar prefix (${XPUB:0:6}…)" ;;
  esac
else
  fail "sqlite.db unreadable from backend container"
fi

echo ""
echo "=== v1.1 — Updater handshake + tenant + GHCR ==="
# Updater PSK — required for backend ↔ updater HMAC handshake.
PSK_LEN=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'echo -n "${NEXORA_UPDATER_PSK:-}" | wc -c' 2>/dev/null | tr -d '\r ' || echo "0")
if [ "$PSK_LEN" -ge 32 ]; then
  pass "NEXORA_UPDATER_PSK length=$PSK_LEN (≥32)"
elif [ "$PSK_LEN" -gt 0 ]; then
  fail "NEXORA_UPDATER_PSK length=$PSK_LEN — need ≥32 chars (generate: openssl rand -hex 32)"
else
  warn "NEXORA_UPDATER_PSK not set — in-place /api/admin/update/apply will refuse"
fi

# Same PSK MUST be present in the updater container (otherwise verify fails).
UPDATER_CID=$(docker compose -f "$COMPOSE_FILE" ps -q updater 2>/dev/null || true)
if [ -n "$UPDATER_CID" ]; then
  pass "updater container running ($UPDATER_CID)"
  UPDATER_PSK_LEN=$(docker compose -f "$COMPOSE_FILE" exec -T updater sh -c 'echo -n "${NEXORA_UPDATER_PSK:-}" | wc -c' 2>/dev/null | tr -d '\r ' || echo "0")
  if [ "$UPDATER_PSK_LEN" = "$PSK_LEN" ] && [ "$PSK_LEN" -ge 32 ]; then
    pass "updater PSK matches backend length=$UPDATER_PSK_LEN"
  elif [ "$UPDATER_PSK_LEN" -gt 0 ] && [ "$UPDATER_PSK_LEN" != "$PSK_LEN" ]; then
    fail "updater PSK length differs from backend ($UPDATER_PSK_LEN vs $PSK_LEN) — handshakes WILL fail"
  fi
else
  warn "updater container not running — auto-update unavailable (manual docker compose still works)"
fi

# Tenant layout — license.lic + machine-id must exist in /data/app for
# encrypted snapshots to derive the right key.
LICENSE_PRESENT=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c '[ -f /data/app/license.lic ] && echo y || echo n' 2>/dev/null | tr -d '\r ' || echo "n")
if [ "$LICENSE_PRESENT" = "y" ]; then
  pass "/data/app/license.lic present"
else
  warn "/data/app/license.lic missing — snapshots will fall back to plain .tar.gz (no encryption)"
fi

MACHINE_ID_LEN=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'test -f /data/app/machine-id && wc -c < /data/app/machine-id || echo 0' 2>/dev/null | tr -d '\r ' || echo "0")
if [ "$MACHINE_ID_LEN" -ge 8 ]; then
  pass "/data/app/machine-id present (${MACHINE_ID_LEN}B)"
else
  warn "/data/app/machine-id missing — ensureMachineId() will mint on next boot (snapshots from before that boot become undecryptable)"
fi

# GHCR token — needed when the updater pulls a per-customer private image.
GHCR_TOKEN_LEN=$(docker compose -f "$COMPOSE_FILE" exec -T backend sh -c 'echo -n "${GHCR_TOKEN:-${NEXORA_GHCR_TOKEN:-}}" | wc -c' 2>/dev/null | tr -d '\r ' || echo "0")
if [ "$GHCR_TOKEN_LEN" -ge 20 ]; then
  pass "GHCR_TOKEN length=$GHCR_TOKEN_LEN (set)"
elif [ "$GHCR_TOKEN_LEN" -gt 0 ]; then
  warn "GHCR_TOKEN length=$GHCR_TOKEN_LEN — looks too short for a real PAT (≥20 expected)"
else
  warn "GHCR_TOKEN not set — public-image customers OK; private per-customer image customers MUST set this"
fi

echo ""
echo "=== Integrity / License (via /api/admin/system/health) ==="
if [ -n "$ADMIN_COOKIE" ]; then
  RESP=$(curl -s --max-time 10 -H "Cookie: $ADMIN_COOKIE" "$HEALTH_URL" || echo "")
  if [ -z "$RESP" ]; then
    warn "health endpoint unreachable at $HEALTH_URL"
  else
    echo "$RESP" | grep -q '"degraded":false' && pass "integrity not degraded" || fail "integrity degraded — see logs"
    echo "$RESP" | grep -q '"ok":true' && pass "integrity verdict ok" || warn "integrity verdict not ok (may be dev-skip)"
  fi
else
  warn "--cookie not supplied; skipping /system/health probe"
fi

echo ""
echo "=== Summary ==="
echo "  FAIL=$FAILS  WARN=$WARNS"
if [ "$FAILS" -gt 0 ]; then
  echo "[go-live] NOT READY — resolve FAILs above before flipping DNS."
  exit 1
fi
echo "[go-live] READY (review WARNs)"
exit 0