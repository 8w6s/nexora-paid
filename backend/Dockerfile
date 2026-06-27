# syntax=docker/dockerfile:1.7
# Combined backend + frontend image.
#
# The customer pulls ONE image; running it starts:
#   - backend  on :3000  (bundled, minified /app/backend/nexora.js)
#   - frontend on :4321  (Astro SSR /app/frontend/dist/server/entry.mjs)
#
# A shell supervisor wires both processes together; if either exits, the
# container exits too so Docker's restart policy can kick.
#
# Per-customer build args — baked as ENV in the runtime stage.
#   NEXORA_INVOICE_ID
#   NEXORA_INVOICE_EMAIL
#   NEXORA_RELEASES_REPO
#   PUBLIC_API_ORIGIN    (frontend build-time only)
#   PUBLIC_SITE_URL      (frontend build-time only)
#
# Build context expects backend/ at the root (this Dockerfile lives in
# backend/) AND ../frontend/ to exist. The compose/workflow build args
# below assume `docker build -f backend/Dockerfile .` from the repo root,
# but the legacy customer-build invocation `context: ./backend` still
# works because we COPY ../frontend explicitly with a relative path
# anchored at the build context (the docker build context is set at the
# workflow level — see customer-build.yml).

# ───────────────────────────── 1. BUILD BACKEND ─────────────────────────────
FROM oven/bun:1 AS build-backend
WORKDIR /build
COPY backend/ ./
RUN bun install --frozen-lockfile || bun install
RUN bun build src/index.ts \
      --minify \
      --sourcemap=none \
      --target=bun \
      --outfile /build/nexora.js
RUN test -s /build/nexora.js

# ───────────────────────────── 2. BUILD FRONTEND ────────────────────────────
FROM oven/bun:1 AS build-frontend
WORKDIR /fe
ARG PUBLIC_API_ORIGIN=http://localhost:3000
ARG PUBLIC_SITE_URL=http://localhost:4321
ENV PUBLIC_API_ORIGIN=$PUBLIC_API_ORIGIN \
    PUBLIC_SITE_URL=$PUBLIC_SITE_URL
COPY frontend/ ./
RUN bun install --frozen-lockfile || bun install
RUN bun run build
RUN test -d /fe/dist/server

# ───────────────────────────── 3. RUNTIME ───────────────────────────────────
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ARG NEXORA_INVOICE_ID=""
ARG NEXORA_INVOICE_EMAIL=""
ARG NEXORA_RELEASES_REPO="8w6s/nexora-releases"
ENV NEXORA_INVOICE_ID=${NEXORA_INVOICE_ID} \
    NEXORA_INVOICE_EMAIL=${NEXORA_INVOICE_EMAIL} \
    NEXORA_RELEASES_REPO=${NEXORA_RELEASES_REPO} \
    NEXORA_APP_ROOT=/app/backend \
    NEXORA_MIGRATIONS_DIR=/app/backend/src/db/migrations \
    PORT=3000 \
    FE_PORT=4321 \
    DB_PATH=/app/data/sqlite.db \
    HOST=0.0.0.0

# Backend bundle + runtime assets (locales + SQL migrations).
COPY --from=build-backend /build/nexora.js              /app/backend/nexora.js
COPY --from=build-backend /build/src/db/migrations      /app/backend/src/db/migrations
COPY --from=build-backend /build/src/lib/locales        /app/backend/src/lib/locales
COPY --from=build-backend /build/package.json           /app/backend/package.json
COPY --from=build-backend /build/node_modules           /app/backend/node_modules

# Frontend SSR bundle. Astro already outputs node-ready ESM under dist/.
COPY --from=build-frontend /fe/dist                     /app/frontend/dist
COPY --from=build-frontend /fe/package.json             /app/frontend/package.json
COPY --from=build-frontend /fe/node_modules             /app/frontend/node_modules

EXPOSE 3000 4321

# Supervisor: start both processes in background, exit the container
# the moment EITHER one exits (so Docker can restart the whole thing).
# We give backend a few seconds to migrate + bind its port before the
# frontend SSR starts hitting fetch('/api/...') during render.
COPY --chmod=0755 <<'SH' /app/start.sh
#!/bin/sh
set -e
mkdir -p $(dirname "$DB_PATH")

echo "[nexora] starting backend on :$PORT"
( cd /app/backend && bun run nexora.js ) &
BACKEND_PID=$!

echo "[nexora] starting frontend on :$FE_PORT"
( cd /app/frontend && PORT="$FE_PORT" bun run dist/server/entry.mjs ) &
FRONTEND_PID=$!

shutdown() {
  echo "[nexora] caught signal, killing both processes"
  kill -TERM "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait
  exit 0
}
trap shutdown INT TERM

# dash doesn't support `wait -n`. Poll both PIDs; exit as soon as either
# is gone so docker can restart the container as a unit.
while :; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[nexora] backend exited"; break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "[nexora] frontend exited"; break
  fi
  sleep 2
done

kill -TERM "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
wait
exit 1
SH

CMD ["/app/start.sh"]