import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema.ts";

const sqlite = new Database("sqlite.db");

/**
 * Minimal forward-only SQL migrator.
 *
 * Reads `*.sql` files from `backend/src/db/migrations/`, sorts them by
 * filename, and applies any that aren't recorded in `_migrations` yet.
 * Each file is run in its own transaction; partial application can't
 * leak through. The tracking table is created on first run.
 *
 * Filename convention: `NNNN_short_description.sql` where NNNN is a
 * zero-padded sequence (0001, 0002, ...). Sort is lexicographic, so
 * keep the padding consistent.
 *
 * Why hand-rolled instead of drizzle-orm's migrator:
 *  - drizzle-kit generate is interactive — the loop can't run it.
 *  - This setup already uses schema.ts as the declarative source of
 *    truth (no .drizzle/ migrations directory exists yet). New tables
 *    get added to schema.ts AND get an explicit SQL file here so the
 *    DB catches up on boot.
 *
 * Empty migrations folder = no-op. Existing DBs see no changes until
 * a new .sql file is added.
 */
function runMigrations(db: Database): void {
  // Resolve the migrations folder relative to THIS file so the lookup
  // works whether the backend is launched from project root, from
  // backend/, or as a bundled build.
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "migrations");
  if (!existsSync(dir)) return; // No migrations folder yet → silent no-op.

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return; // Unreadable folder → no-op rather than crash boot.
  }
  if (files.length === 0) return;

  // Tracking table: created on first migrator run, then queried each boot.
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    filename TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`);

  const applied = new Set(
    db.query("SELECT filename FROM _migrations").all().map((r: any) => r.filename as string),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    // Each migration runs in its own transaction so a syntax error in
    // one file can't half-apply.
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO _migrations (filename) VALUES (?)").run(file);
    })();
    console.log(`[migrate] applied ${file}`);
  }
}

runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });
