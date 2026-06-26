/**
 * After `drizzle-kit push` bootstraps a fresh SQLite from schema.ts, the
 * legacy migrations/*.sql files become redundant — they were ALTER-style
 * patches on top of an older schema, and replaying them throws
 * "duplicate column" / "table already exists".
 *
 * This script seeds the `_migrations` tracking table with every existing
 * SQL file as if it were already applied. The runtime migrator in
 * connection.ts then sees the full set on next boot and no-ops cleanly.
 *
 * Idempotent: re-runs are safe (INSERT OR IGNORE).
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(here, "..", "..", "sqlite.db");

const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  filename TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
)`);

const migrationsDir = join(here, "migrations");
if (!existsSync(migrationsDir)) {
  console.log("[mark-migrations] no migrations folder — nothing to do");
  db.close();
  process.exit(0);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const stmt = db.prepare("INSERT OR IGNORE INTO _migrations (filename) VALUES (?)");
let count = 0;
for (const f of files) {
  const r = stmt.run(f);
  if (r.changes > 0) count++;
}

console.log(`[mark-migrations] marked ${count}/${files.length} migrations as applied`);
db.close();