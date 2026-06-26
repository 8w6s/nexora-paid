#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════
# Nexora Paid — Order Fulfillment Script
#
# Run this AFTER a customer pays. It:
#   1. Signs a .license file for the customer
#   2. Builds the release ZIP with everything they need
#   3. Outputs the ZIP path ready to upload / email
#
# Usage:
#   bash scripts/fulfill-order.sh \
#     --email=customer@example.com \
#     --customer=cus_2026_001 \
#     --tier=standard            # standard | lifetime
#
# Prerequisites:
#   - .keys/license-signer.private exists (run scripts/gen-keypair.ts first)
#   - bun installed
# ════════════════════════════════════════════════

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Parse args
EMAIL="" CUSTOMER="" TIER="standard" NOTE=""
for arg in "$@"; do
  case "$arg" in
    --email=*) EMAIL="${arg#*=}" ;;
    --customer=*) CUSTOMER="${arg#*=}" ;;
    --tier=*) TIER="${arg#*=}" ;;
    --note=*) NOTE="${arg#*=}" ;;
  esac
done

if [ -z "$EMAIL" ]; then
  echo "Usage: bash scripts/fulfill-order.sh --email=x@y.com --customer=cus_001 [--tier=standard|lifetime]"
  exit 1
fi

SAFE_EMAIL=$(echo "$EMAIL" | tr -c 'a-z0-9' '_')
RELEASE_DIR="$ROOT/releases/$SAFE_EMAIL"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# ─── Step 1: Sign license ────────────────────────────────────────────
echo "[1/4] Signing license for $EMAIL (tier=$TIER)..."
TTL_FLAG=""
if [ "$TIER" = "standard" ]; then
  TTL_FLAG="--ttl=365"
fi
# lifetime = no --ttl (no expiresAt field = valid forever)

FEATURES="search-suggest,admin-bulk,admin-export,admin-customers-csv"
LICENSE_NOTE="${TIER}, fulfilled $(date +%Y-%m-%d)"
[ -n "$NOTE" ] && LICENSE_NOTE="$LICENSE_NOTE — $NOTE"

bun run scripts/sign-license.ts \
  --email="$EMAIL" \
  --customer="${CUSTOMER:-$SAFE_EMAIL}" \
  $TTL_FLAG \
  --features="$FEATURES" \
  --note="$LICENSE_NOTE" \
  --out="$RELEASE_DIR/nexora.license"

# ── Step 2: Copy release template ──────────────────────────────────
echo "[2/4] Assembling release package..."
cp "$ROOT/releases-template/"* "$RELEASE_DIR/" 2>/dev/null || true
cp "$ROOT/docker-compose.yml" "$RELEASE_DIR/"
cp "$ROOT/docker-compose.updater.yml" "$RELEASE_DIR/" 2>/dev/null || true
cp "$ROOT/Caddyfile" "$RELEASE_DIR/"
cp "$ROOT/Caddyfile.tunnel" "$RELEASE_DIR/"
cp "$ROOT/.env.example" "$RELEASE_DIR/"
cp "$ROOT/scripts/nexora-backup.sh" "$RELEASE_DIR/" 2>/dev/null || true
cp "$ROOT/scripts/nexora-restore-drill.sh" "$RELEASE_DIR/" 2>/dev/null || true
cp "$ROOT/scripts/nexora-go-live-check.sh" "$RELEASE_DIR/" 2>/dev/null || true
cp "$ROOT/docs/CUSTOMER_ONBOARDING.md" "$RELEASE_DIR/README.md"
cp "$ROOT/docs/DEPLOYMENT.md" "$RELEASE_DIR/"
cp "$ROOT/TERMS.md" "$RELEASE_DIR/"

# ─── Step 3: Archive ─────────────────────────────────────────────────
echo "[3/4] Creating archive..."
ZIP_PATH="$ROOT/releases/${SAFE_EMAIL}_nexora-paid.zip"
if command -v zip &>/dev/null; then
  (cd "$ROOT/releases" && zip -r "$ZIP_PATH" "$SAFE_EMAIL/" -x "*.DS_Store")
elif command -v powershell.exe &>/dev/null; then
  WIN_SRC="$(cygpath -w "$RELEASE_DIR")\\*"
  WIN_DST="$(cygpath -w "$ZIP_PATH")"
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$WIN_SRC' -DestinationPath '$WIN_DST' -Force"
else
  tar -czf "${ZIP_PATH%.zip}.tar.gz" -C "$ROOT/releases" "$SAFE_EMAIL/"
  ZIP_PATH="${ZIP_PATH%.zip}.tar.gz"
fi

# ─── Step 4: Summary ────────────────────────────────────
echo "[4/4] Done!"
echo ""
echo "═══════════════════════════════════════════"
echo "  Customer: $EMAIL"
echo "  Tier:     $TIER"
echo "  License:  $RELEASE_DIR/nexora.license"
echo "  ZIP:      $ZIP_PATH"
echo "═══════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Upload ZIP to a private link (Catbox, Google Drive, S3 presigned URL)"
echo "  2. Email customer the download link + their install instructions"
echo "  3. Record in your sales tracker"
echo ""