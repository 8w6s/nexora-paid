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
# Maximum obfuscation:
#   --minify              identifiers + whitespace + syntax (default chord)
#   --drop=console        rip every console.* call out of the bundle so dev
#                         logs can't leak hints about internal structure
#   --drop=debugger       same for stray debugger statements
#   --sourcemap=none      no `.map` file → no original filenames/line nos
#   --target=bun          let bun keep its own builtins external
# bun build doesn't support esbuild's --drop=console flag yet; rely on
# --minify-identifiers (built into --minify) to mangle every internal name
# so a `strings` dump on nexora.js reveals nothing useful even though
# console.* calls survive.
RUN bun build src/index.ts \
      --minify \
      --minify-syntax \
      --minify-whitespace \
      --minify-identifiers \
      --sourcemap=none \
      --target=bun \
      --outfile /build/nexora.js \
  && test -s /build/nexora.js

# Strip ALL non-runtime cruft from node_modules before the COPY into the
# runtime stage. Saves disk + removes upstream package source/tests/docs
# from the customer image surface.
RUN find /build/node_modules \
      \( -name "*.md" -o -name "*.markdown" \
         -o -name "*.ts" ! -name "*.d.ts" \
         -o -name "*.map" -o -name "*.flow" -o -name "*.tsbuildinfo" \
         -o -name "LICENSE*" -o -name "license*" -o -name "CHANGELOG*" \
         -o -name "AUTHORS*" -o -name "CONTRIBUTORS*" -o -name "HISTORY*" \) \
      -type f -delete \
  && find /build/node_modules \
      \( -name "test" -o -name "tests" -o -name "__tests__" \
         -o -name "example" -o -name "examples" -o -name "docs" \
         -o -name "doc" -o -name ".github" -o -name ".husky" \) \
      -type d -prune -exec rm -rf {} +

# ───────────────────────────── 2. BUILD FRONTEND ────────────────────────────
FROM oven/bun:1 AS build-frontend
WORKDIR /fe
# IMPORTANT: PUBLIC_API_ORIGIN is BAKED into the client bundle at build time.
# In the combined image, both backend (:3000) and frontend (:4321) run in the
# same container; only the frontend port is exposed to the customer's host.
# Setting PUBLIC_API_ORIGIN to "" forces browser-side fetch to use same-origin
# relative URLs (/api/*), which the Astro middleware then proxies internally
# to the backend on localhost:3000. Never bake an absolute backend URL here —
# the customer's host has no route to it.
ARG PUBLIC_API_ORIGIN=""
ARG PUBLIC_SITE_URL=http://localhost:4321
ENV PUBLIC_API_ORIGIN=$PUBLIC_API_ORIGIN \
    PUBLIC_SITE_URL=$PUBLIC_SITE_URL
COPY frontend/ ./
RUN bun install --frozen-lockfile || bun install
RUN bun run build
RUN test -d /fe/dist/server

# Production install drops devDependencies (typescript, vite, prettier,
# @shikijs, etc.) — those are build-time only. Saves ~150 MB on the
# final image.
RUN rm -rf node_modules \
  && (bun install --production --frozen-lockfile || bun install --production)

# Trim upstream package cruft from the now-smaller production tree.
RUN find /fe/node_modules \
      \( -name "*.md" -o -name "*.markdown" \
         -o -name "*.ts" ! -name "*.d.ts" \
         -o -name "*.map" -o -name "*.flow" -o -name "*.tsbuildinfo" \
         -o -name "LICENSE*" -o -name "license*" -o -name "CHANGELOG*" \
         -o -name "AUTHORS*" -o -name "CONTRIBUTORS*" -o -name "HISTORY*" \) \
      -type f -delete \
  && find /fe/node_modules \
      \( -name "test" -o -name "tests" -o -name "__tests__" \
         -o -name "example" -o -name "examples" -o -name "docs" \
         -o -name "doc" -o -name ".github" -o -name ".husky" \) \
      -type d -prune -exec rm -rf {} +

# ───────────────────────────── 3. RUNTIME ───────────────────────────────────
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ARG NEXORA_INVOICE_ID=""
ARG NEXORA_INVOICE_EMAIL=""
ARG NEXORA_RELEASES_REPO="8w6s/nexora-releases"
# Read-only PAT for nexora-releases (contents:read on that ONE repo).
# Baked at build time so customer admins never see it directly — they
# can `docker inspect` of course, but it's a read-only token scoped to
# the private registry the maintainer controls. Rotate by re-running
# customer-build.yml with a fresh NEXORA_RELEASES_PAT secret; the in-app
# update flow then pulls a new image with the new token.
ARG NEXORA_RELEASES_PAT=""
ENV NEXORA_INVOICE_ID=${NEXORA_INVOICE_ID} \
    NEXORA_INVOICE_EMAIL=${NEXORA_INVOICE_EMAIL} \
    NEXORA_RELEASES_REPO=${NEXORA_RELEASES_REPO} \
    NEXORA_GHCR_TOKEN=${NEXORA_RELEASES_PAT} \
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