import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

// Resolve DB path absolutely so cwd-dependent invocations (root vs backend/)
// always hit the same file. DB_PATH env wins; default = <repo>/backend/sqlite.db.
// Previously the file was implicitly "./sqlite.db" relative to cwd, which meant
// `bun run sed` from repo root and `bun run dev` from backend wrote to two
// different SQLite files.
const __here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = Bun.env.DB_PATH ? resolve(Bun.env.DB_PATH) : resolve(__here, "../../sqlite.db");
const sqlite = new Database(DB_PATH);

// WAL + sane defaults: WAL lets readers proceed during writes (watcher tick
// doesn't block API requests), busy_timeout retries instead of throwing
// SQLITE_BUSY, foreign_keys is OFF by default in SQLite (!) — we need it on
// for the FK cascades baked into the schema to actually fire.
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");
sqlite.exec("PRAGMA busy_timeout = 5000;");
sqlite.exec("PRAGMA foreign_keys = ON;");

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
    // one file can't half-apply. The try/catch surfaces the offending
    // filename — bun:sqlite otherwise reports only a byteOffset which is
    // useless when nine migrations are queued behind a fresh shop boot.
    try {
      db.transaction(() => {
        db.exec(sql);
        db.query("INSERT INTO _migrations (filename) VALUES (?)").run(file);
      })();
    } catch (e) {
      console.error(
        `[migrate] ${file} failed:`,
        e instanceof Error ? e.message : String(e),
      );
      throw e;
    }
  }
}

runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });