# Backend — Elysia + Bun + SQLite, shipped as a compiled single-file binary.
#
# Two stages:
#   - build:   has bun + the full TS tree; compiles src/index.ts into a
#              self-contained `nexora` binary via bun build --compile.
#   - runtime: oven/bun:slim. Only the compiled binary, the asset files
#              the runtime reads at startup (migrations/, locales/), the
#              minimal package.json + drizzle config + schema.ts needed
#              for the bootstrap `drizzle-kit push` on a fresh DB, plus
#              node_modules. NO src/*.ts beyond schema.ts; NO scripts/;
#              NO test files; NO dev DB backup.
#
# Per-customer build args (baked as ENV) — see customer-build.yml.
#   NEXORA_INVOICE_ID
#   NEXORA_INVOICE_EMAIL
#   NEXORA_RELEASES_REPO

# ───────────────────────────── 1. BUILD ─────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /build

# Install deps once on top of the cacheable layer.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Pull in the rest of the source tree (after .dockerignore filtering).
COPY . .

# Compile the app entrypoint into a static binary. --bytecode hides the
# JavaScript source from a `strings` dump; --minify shortens identifiers
# even inside bytecode metadata; --sourcemap=none drops file paths that
# would otherwise leak module names.
# Bundle the whole TS tree into a single minified .js. `--compile` would
# also work but Bun refuses top-level `await` in the entry file, which
# index.ts uses heavily; bundling to a .js file lets Bun's runtime evaluate
# TLA normally. Source maps + identifier names are stripped so the customer
# image leaks neither the original file layout nor most identifiers.
RUN bun build src/index.ts \
      --minify \
      --sourcemap=none \
      --target=bun \
      --outfile /build/nexora.js

# Sanity check: the bundle must exist and be non-empty.
RUN test -s /build/nexora.js

# ───────────────────────────── 2. RUNTIME ─────────────────────────────
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ARG NEXORA_INVOICE_ID=""
ARG NEXORA_INVOICE_EMAIL=""
ARG NEXORA_RELEASES_REPO="8w6s/nexora-releases"
ENV NEXORA_INVOICE_ID=${NEXORA_INVOICE_ID} \
    NEXORA_INVOICE_EMAIL=${NEXORA_INVOICE_EMAIL} \
    NEXORA_RELEASES_REPO=${NEXORA_RELEASES_REPO} \
    NEXORA_APP_ROOT=/app \
    NEXORA_MIGRATIONS_DIR=/app/src/db/migrations \
    PORT=3000 \
    DB_PATH=/app/data/sqlite.db

# 1. Bundled, minified JS — the only application code shipped to customers.
COPY --from=build /build/nexora.js /app/nexora.js

# 2. Runtime-loaded assets the binary opens by path at startup.
#    These live in named subdirs so we don't sneak in any other .ts files.
COPY --from=build /build/src/db/migrations /app/src/db/migrations
COPY --from=build /build/src/lib/locales   /app/src/lib/locales

# 3. Bun runtime needs the node_modules tree to require()
#    bun:sqlite + the small set of native deps the bundle leaves
#    external. drizzle-kit is intentionally NOT copied: 0000_init.sql in
#    migrations/ already carries the full HEAD schema, so a fresh DB is
#    bootstrapped purely by the in-bundle migrator.
COPY --from=build /build/package.json /app/package.json
COPY --from=build /build/node_modules /app/node_modules

EXPOSE 3000

# Boot sequence:
#   1. Ensure the SQLite directory exists in the mounted volume.
#   2. If the DB file is empty/missing → bootstrap fresh:
#        a. drizzle-kit push (creates every table from schema.ts).
#        b. let the compiled binary handle migrations + seed on first start.
#   3. exec the binary — it now runs the connection.ts migrator, then app.
CMD ["sh", "-c", "mkdir -p $(dirname $DB_PATH); exec bun run /app/nexora.js"]