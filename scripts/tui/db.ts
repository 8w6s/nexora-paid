import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Resolve giong backend/src/db/connection.ts: DB_PATH env wins, default
// = <repo>/backend/sqlite.db. Khong import drizzle - khong can ORM cho TUI.
function resolveDbPath(): string {
  if (Bun.env.DB_PATH) return resolve(Bun.env.DB_PATH);
  return resolve(process.cwd(), "backend/sqlite.db");
}

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;
  const path = resolveDbPath();
  if (!existsSync(path)) {
    throw new Error(`db file not found: ${path}`);
  }
  // readonly=false de cho phep INSERT/UPDATE/DELETE neu user muon. SAFE:
  // chi dung trong dev TUI, khong phai prod.
  _db = new Database(path);
  return _db;
}

export function dbPath(): string {
  return resolveDbPath();
}

export function listTables(): { name: string; rowCount: number }[] {
  const db = getDb();
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
    )
    .all();
  return tables.map((t) => {
    let rowCount = 0;
    try {
      const row = db.query<{ c: number }, []>(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
      rowCount = row?.c ?? 0;
    } catch {}
    return { name: t.name, rowCount };
  });
}

export type Column = { name: string; type: string; pk: number; notnull: number };

export function describeTable(table: string): Column[] {
  const db = getDb();
  return db.query<Column, []>(`PRAGMA table_info("${table}")`).all();
}

export function fetchRows(table: string, limit: number, offset: number): Record<string, unknown>[] {
  const db = getDb();
  return db
    .query<Record<string, unknown>, [number, number]>(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`)
    .all(limit, offset);
}

export type QueryResult =
  | { kind: "rows"; columns: string[]; rows: Record<string, unknown>[]; count: number }
  | { kind: "exec"; changes: number; lastInsertRowid: number | bigint }
  | { kind: "error"; message: string };

export function runQuery(sql: string): QueryResult {
  try {
    const db = getDb();
    const trimmed = sql.trim();
    const isSelect = /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(trimmed);
    if (isSelect) {
      const stmt = db.query(trimmed);
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { kind: "rows", columns, rows, count: rows.length };
    }
    const result = db.run(trimmed);
    return {
      kind: "exec",
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  } catch (e: any) {
    return { kind: "error", message: e?.message ?? String(e) };
  }
}

export function closeDb() {
  if (_db) {
    try {
      _db.close();
    } catch {}
    _db = null;
  }
}

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") {
    if (v.length > 60) return v.slice(0, 57) + "...";
    return v;
  }
  if (typeof v === "object") {
    if (v instanceof Uint8Array) return `<blob ${v.length}b>`;
    return JSON.stringify(v);
  }
  return String(v);
}
