import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

const sqlite = new Database("sqlite.db");

/**
 * Minimal forward-only SQL migrator.
 */
function runMigrations(db: Database): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "migrations");
  if (!existsSync(dir)) return; // No migrations folder yet → silent no-op.

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
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
    db
      .query("SELECT filename FROM _migrations")
      .all()
      .map((r: any) => r.filename as string),
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
  }
}

runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });
