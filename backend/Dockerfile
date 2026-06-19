# Backend — Elysia + Bun + SQLite
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps (cache layer)
COPY package.json ./
RUN bun install

# App source
COPY . .

# SQLite lives at $DB_PATH (default /app/data/sqlite.db in compose). Mount a
# volume at /app/data — NOT /app — so the persisted state stays separate from
# the source tree and rebuilds keep working.
ENV PORT=3000
ENV DB_PATH=/app/data/sqlite.db
EXPOSE 3000

# Seed on first boot only — schema migrations are applied by connection.ts on
# every boot (idempotent forward-only migrator). seed.ts re-inserts product
# keys so it must NOT run on warm boots; gate on absence of the DB file.
CMD ["sh", "-c", "mkdir -p $(dirname $DB_PATH); [ -s $DB_PATH ] || bun src/db/seed.ts; bun src/index.ts"]
