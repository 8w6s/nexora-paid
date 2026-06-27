# Backend — Elysia + Bun + SQLite
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps (cache layer)
COPY package.json ./
RUN bun install

# App source
COPY . .

# Per-customer build args. Baked into the image as ENV so the running
# backend can read them but the customer-admin cannot rewrite them at
# runtime (they live in image layers signed by GHCR).
#
#   NEXORA_INVOICE_ID     stable id you mint when issuing the customer's
#                         invoice. The backend uses it to fetch
#                         invoices/<id>.json from the private releases
#                         repo at boot + every 24h. Empty → image runs in
#                         "dev/unlicensed" mode (paid plugins off).
#   NEXORA_INVOICE_EMAIL  watermark only; appears in boot banner so a
#                         leaked image is traceable. Optional.
#   NEXORA_RELEASES_REPO  defaults to 8w6s/nexora-releases; override if
#                         you fork.
ARG NEXORA_INVOICE_ID=""
ARG NEXORA_INVOICE_EMAIL=""
ARG NEXORA_RELEASES_REPO="8w6s/nexora-releases"
ENV NEXORA_INVOICE_ID=${NEXORA_INVOICE_ID} \
    NEXORA_INVOICE_EMAIL=${NEXORA_INVOICE_EMAIL} \
    NEXORA_RELEASES_REPO=${NEXORA_RELEASES_REPO}

# SQLite lives at $DB_PATH (default /app/data/sqlite.db in compose). Mount a
# volume at /app/data — NOT /app — so the persisted state stays separate from
# the source tree and rebuilds keep working.
ENV PORT=3000
ENV DB_PATH=/app/data/sqlite.db
EXPOSE 3000

# Boot sequence:
#   1. Ensure DB directory exists.
#   2. If DB file empty/missing → bootstrap fresh:
#      a. drizzle-kit push (creates every table from schema.ts).
#      b. mark every legacy migrations/*.sql as already-applied (they were
#         ALTER patches on top of an older schema; a fresh drizzle-push
#         starts at HEAD so re-running them throws "duplicate column").
#      c. seed demo data.
#   3. Start the app — connection.ts's migrator now sees a full _migrations
#      table and no-ops cleanly.
CMD ["sh", "-c", "mkdir -p $(dirname $DB_PATH); if [ ! -s $DB_PATH ]; then echo y | bunx drizzle-kit push --config=drizzle.config.ts || true; bun src/db/mark-migrations-applied.ts; bun src/db/seed.ts; fi; bun src/index.ts"]