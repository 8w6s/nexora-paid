# Backend — Elysia + Bun + SQLite
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps (cache layer)
COPY package.json ./
RUN bun install

# App source
COPY . .

# SQLite lives at /app/sqlite.db — mount a volume here to persist (importable single file).
ENV PORT=3000
EXPOSE 3000

# Seed on first boot if the DB is empty, then start. (push schema + seed are idempotent-ish.)
CMD ["sh", "-c", "bunx drizzle-kit push --config drizzle.config.ts || true; [ -s sqlite.db ] || bun src/db/seed.ts; bun src/index.ts"]
