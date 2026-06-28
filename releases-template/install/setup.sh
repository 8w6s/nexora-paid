#!/usr/bin/env bash
# Nexora interactive setup — friendly Linux / macOS / WSL installer.
#
# Run from a fresh host:
#
#   curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.sh \
#     | bash
#
# Or download then run:
#
#   curl -fsSL https://raw.githubusercontent.com/8w6s/nexora-install/main/setup.sh -o setup.sh
#   chmod +x setup.sh
#   ./setup.sh
#
# The script walks you through:
#   1. Your invoice id (given to you when you paid)
#   2. Admin email (optional)
#   3. Backend + frontend ports (optional)
#   4. Public origin (set this when running behind a domain + HTTPS)
#
# Then generates ./nexora/.env, writes ./nexora/docker-compose.yml,
# pulls the per-invoice image, and brings everything up.

set -euo pipefail

# ── colour theme ──────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_RESET=$(tput sgr0); C_BOLD=$(tput bold); C_DIM=$(tput dim)
  C_BRAND=$(tput setaf 6); C_OK=$(tput setaf 2); C_WARN=$(tput setaf 3); C_ERR=$(tput setaf 1); C_INFO=$(tput setaf 4)
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_BRAND=""; C_OK=""; C_WARN=""; C_ERR=""; C_INFO=""
fi

banner() {
  printf '\n%s' "${C_BRAND}"
  cat <<'BANNER'
   _   _
  | \ | | _____  _____  _ __ __ _
  |  \| |/ _ \ / / _ \| '__/ _` |
  | |\  |  __/>  < (_) | | | (_| |
  |_| \_|\___/_/\_\___/|_|  \__,_|
BANNER
  printf '%s\n' "${C_RESET}"
  printf '  %sSelf-host setup wizard%s\n\n' "${C_DIM}" "${C_RESET}"
}

step()   { printf '\n%s▸%s %s%s%s\n' "${C_BRAND}" "${C_RESET}" "${C_BOLD}" "$*" "${C_RESET}"; }
info()   { printf '  %s%s%s\n' "${C_INFO}" "$*" "${C_RESET}"; }
ok()     { printf '  %s✓%s %s\n' "${C_OK}" "${C_RESET}" "$*"; }
warn()   { printf '  %s!%s %s\n' "${C_WARN}" "${C_RESET}" "$*"; }
fail()   { printf '\n  %s✗%s %s\n\n' "${C_ERR}" "${C_RESET}" "$*" >&2; exit 1; }

prompt() {
  # prompt <var-name> "<question>" [default] [validator-fn]
  local __var="$1" __q="$2" __def="${3:-}" __validator="${4:-}"
  local __val
  while :; do
    if [ -n "$__def" ]; then
      printf '  %s?%s %s %s[%s]%s: ' "${C_BRAND}" "${C_RESET}" "$__q" "${C_DIM}" "$__def" "${C_RESET}"
    else
      printf '  %s?%s %s: ' "${C_BRAND}" "${C_RESET}" "$__q"
    fi
    if ! IFS= read -r __val </dev/tty; then
      fail "no terminal available for prompts — pipe stdin then re-run"
    fi
    [ -z "$__val" ] && __val="$__def"
    if [ -n "$__validator" ]; then
      if "$__validator" "$__val"; then
        printf -v "$__var" '%s' "$__val"; return 0
      fi
    else
      [ -n "$__val" ] || { warn "value required"; continue; }
      printf -v "$__var" '%s' "$__val"; return 0
    fi
  done
}

validate_invoice() {
  if printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._-]{4,64}$'; then
    return 0
  fi
  warn "invoice id must match [A-Za-z0-9._-]{4,64}"
  return 1
}

validate_email() {
  if printf '%s' "$1" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'; then
    return 0
  fi
  warn "invalid email shape"
  return 1
}

# Probe whether the host can bind a port. Cross-platform: prefer
# Bun/Node-free tools (bash's /dev/tcp doesn't work for listening; ss/lsof
# is cheap but only tells us about existing listeners). Best-effort:
# treat "in use" as not-bindable; if neither tool is around we trust the
# user.
port_bindable() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lnt "sport = :$p" 2>/dev/null | grep -q ":$p\b" && return 1
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$p" -sTCP:LISTEN -P >/dev/null 2>&1 && return 1
    return 0
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | grep -q ":$p\b" && return 1
    return 0
  fi
  return 0
}

# Random pick in the safe 20000-45000 band (above well-known/registered
# but below the Linux ephemeral range start of 32768-60999 — overlap is
# fine because port_bindable also checks "currently listening"). Tries
# up to 50 random picks before giving up.
find_free_port() {
  local p attempt=0
  while [ "$attempt" -lt 50 ]; do
    p=$((20000 + RANDOM % 25001))
    if port_bindable "$p"; then printf '%s\n' "$p"; return 0; fi
    attempt=$((attempt + 1))
  done
  printf '%s\n' "0"
}

validate_port() {
  if ! printf '%s' "$1" | grep -Eq '^[0-9]{1,5}$' || [ "$1" -lt 1 ] || [ "$1" -gt 65535 ]; then
    warn "port must be 1-65535"
    return 1
  fi
  if ! port_bindable "$1"; then
    local s
    s=$(find_free_port)
    if [ "$s" != "0" ]; then
      warn "port $1 is in use on this host — try $s or another free port"
    else
      warn "port $1 is in use on this host — no free port found, try one manually"
    fi
    return 1
  fi
  return 0
}

validate_origin() {
  case "$1" in
    http://*|https://*) return 0 ;;
  esac
  warn "origin must start with http:// or https://"
  return 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing required command: $1"
  fi
}

# ─── 0. preflight ──────────────────────────────────
banner
step "Checking prerequisites"

require_cmd docker
require_cmd openssl
if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose plugin missing — install docker-compose-plugin (or Docker Desktop's bundled compose)"
fi

if ! docker info >/dev/null 2>&1; then
  fail "the docker daemon doesn't seem to be running. Start Docker Desktop / the docker service, then re-run."
fi
ok "docker + docker compose ready"

# ─── 1. interactive questions ──────────────────────────────────
step "Tell us about this install"

INVOICE_DEFAULT="${INVOICE:-}"
prompt INVOICE "Your invoice id" "$INVOICE_DEFAULT" validate_invoice
BE_DEFAULT="${HOST_BACKEND_PORT:-3000}"
if ! port_bindable "$BE_DEFAULT"; then BE_DEFAULT=$(find_free_port); fi
FE_DEFAULT="${HOST_FRONTEND_PORT:-4321}"
if ! port_bindable "$FE_DEFAULT"; then FE_DEFAULT=$(find_free_port); fi
[ "$BE_DEFAULT" = "0" ] && fail "cannot find a free TCP port on this host"
[ "$FE_DEFAULT" = "0" ] && fail "cannot find a free TCP port on this host"
prompt HOST_BACKEND_PORT  "Backend port (host)"  "$BE_DEFAULT" validate_port
prompt HOST_FRONTEND_PORT "Frontend port (host)" "$FE_DEFAULT" validate_port
prompt PUBLIC_ORIGIN "Public origin (URL customers will visit)" \
  "${PUBLIC_ORIGIN:-http://localhost:${HOST_FRONTEND_PORT}}" validate_origin

INSTALL_DIR="${INSTALL_DIR:-$PWD/nexora}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/8w6s/nexora}"
TAG="${TAG:-latest-${INVOICE}}"

# Production refuses to boot without HTTPS — auto-pick a sane NODE_ENV.
case "$PUBLIC_ORIGIN" in
  https://*) NODE_ENV=production ;;
  *)         NODE_ENV=development ;;
esac

# ─── 2. echo plan back ────────────────────────────────────────────────────
step "Plan"
printf '  %sInvoice id:%s  %s\n'   "${C_DIM}" "${C_RESET}" "$INVOICE"
printf '  %sBackend  →%s   localhost:%s\n' "${C_DIM}" "${C_RESET}" "$HOST_BACKEND_PORT"
printf '  %sFrontend →%s   localhost:%s\n' "${C_DIM}" "${C_RESET}" "$HOST_FRONTEND_PORT"
printf '  %sPublic origin:%s %s\n' "${C_DIM}" "${C_RESET}" "$PUBLIC_ORIGIN"
printf '  %sMode:%s        %s\n'   "${C_DIM}" "${C_RESET}" "$NODE_ENV"
printf '  %sImage:%s       %s:%s\n' "${C_DIM}" "${C_RESET}" "$IMAGE_REPO" "$TAG"
printf '  %sInstall dir:%s %s\n'   "${C_DIM}" "${C_RESET}" "$INSTALL_DIR"
echo
prompt CONFIRM "Proceed? (y/N)" "n"
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) fail "aborted by user" ;;
esac

# ─── 3. filesystem ────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"

randhex() { openssl rand -hex 32; }
randpw()  { openssl rand -base64 18 | tr -d '/+=\n' | cut -c1-24; }

step "Writing $ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  warn "existing .env detected — preserving secrets, only updating invoice + ports"
  python3 - "$ENV_FILE" "$INVOICE" "$PUBLIC_ORIGIN" "$NODE_ENV" <<'PY'
import sys, re, io
path, inv, origin, env = sys.argv[1:]
with io.open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()
def upsert(k, v):
    pat = re.compile(rf"^{re.escape(k)}=")
    for i, l in enumerate(lines):
        if pat.match(l):
            lines[i] = f"{k}={v}\n"; return
    lines.append(f"{k}={v}\n")
upsert("NEXORA_INVOICE_ID", inv)
upsert("PUBLIC_ORIGIN", origin)
upsert("NODE_ENV", env)
with io.open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)
PY
  ok "updated in place"
else
  # Admin is created via /setup wizard on first boot. Don't seed
  # ADMIN_EMAIL/ADMIN_PASSWORD — the backend would otherwise
  # bootstrap an account and skip the wizard.
  {
    echo "# Generated by setup.sh — keep this file private"
    echo "NEXORA_INVOICE_ID=$INVOICE"
    echo "NODE_ENV=$NODE_ENV"
    echo "PUBLIC_ORIGIN=$PUBLIC_ORIGIN"
    echo "ORDER_TOKEN_SECRET=$(randhex)"
    echo "DATABASE_ENCRYPTION_KEY=$(randhex)"
    echo "NEXORA_LICENSE_SECRET=$(randhex)"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "generated secrets"
fi

step "Writing $COMPOSE_FILE"
cat > "$COMPOSE_FILE" <<YAML
services:
  nexora:
    image: ${IMAGE_REPO}:${TAG}
    restart: unless-stopped
    env_file: .env
    ports:
      - "${HOST_BACKEND_PORT}:3000"
      - "${HOST_FRONTEND_PORT}:4321"
    volumes:
      - nexora-db:/app/data
    healthcheck:
      test: ["CMD", "sh", "-c", "wget -qO- http://localhost:3000/api/health >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  nexora-db:
YAML
ok "compose file ready"

# ─── 4. pull image ────────────────────────────────────────────────────────
step "Pulling ${IMAGE_REPO}:${TAG}"
if docker compose -f "$COMPOSE_FILE" pull --quiet 2>&1; then
  ok "pulled"
else
  fail "pull failed — check your invoice id matches a published image"
fi

# ─── 5. up + healthcheck ──────────────────────────────────────────────────
step "Starting Nexora"
docker compose -f "$COMPOSE_FILE" up -d
ok "containers started"

info "waiting for the API on http://localhost:${HOST_BACKEND_PORT}/api/health"
READY=""
for i in $(seq 1 30); do
  if curl -fsS --max-time 4 "http://localhost:${HOST_BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    READY=1; break
  fi
  printf '%s.%s' "${C_DIM}" "${C_RESET}"
  sleep 3
done
echo

if [ -z "$READY" ]; then
  warn "health check did not pass within ~90s — last 40 log lines:"
  docker compose -f "$COMPOSE_FILE" logs --tail=40 >&2 || true
  fail "install incomplete — fix the issue above and re-run setup.sh"
fi

# ─── 6. final card ────────────────────────────────────
echo
printf '  %s%s═══════════════════════════════════════════════════════════%s\n' "${C_BRAND}" "${C_BOLD}" "${C_RESET}"
printf '  %s%s  Nexora is live%s\n' "${C_BRAND}" "${C_BOLD}" "${C_RESET}"
printf '  %s%s═══════════════════════════════════════════════════════════%s\n' "${C_BRAND}" "${C_BOLD}" "${C_RESET}"
printf '  Storefront  %s%s%s\n' "${C_OK}" "$PUBLIC_ORIGIN" "${C_RESET}"
printf '  First-run setup wizard:\n'
printf '              %s%s/setup%s\n' "${C_OK}" "$PUBLIC_ORIGIN" "${C_RESET}"
printf '  %s(create your admin account, paste your Litecoin xpub, done)%s\n' "${C_DIM}" "${C_RESET}"
echo
printf '  %sLogs:%s    docker compose -f %s logs -f\n' "${C_DIM}" "${C_RESET}" "$COMPOSE_FILE"
printf '  %sStop:%s    docker compose -f %s down\n'    "${C_DIM}" "${C_RESET}" "$COMPOSE_FILE"
printf '  %sUpgrade:%s re-run this installer (curl | bash)\n' "${C_DIM}" "${C_RESET}"
echo