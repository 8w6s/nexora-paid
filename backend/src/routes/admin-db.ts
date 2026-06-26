/**
 * Admin DB Editor — power-user SQL console.
 *
 * Audience: maintainer + power-user customers with admin role.
 * NOT exposed to non-admin sessions. Every mutation is appended to audit_log.
 *
 * Safety net (NOT an attempt at full SQL sandbox — admin already has the
 * keys to the kingdom; the guard rails exist to prevent foot-guns):
 *   - statements containing ATTACH / DETACH refused
 *   - PRAGMA load_extension refused
 *   - result rows capped at 5000
 *   - statement length capped at 64 KB
 *   - audit_log itself is read-only via this route (UPDATE/DELETE on it rejected)
 */
import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import { sqlite } from "../db/connection.ts";
import { readAudit, recordAudit } from "../lib/audit-log.ts";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { clientIp, rateLimitCheck } from "../lib/rate-limit.ts";

const MAX_STMT_LEN = 64 * 1024;
const MAX_ROWS = 5000;

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\battach\s+database\b/i, reason: "ATTACH DATABASE is not permitted" },
  { re: /\bdetach\s+database\b/i, reason: "DETACH DATABASE is not permitted" },
  { re: /load_extension\s*\(/i, reason: "load_extension() is not permitted" },
  {
    re: /\bpragma\s+(journal_mode|locking_mode|foreign_keys|key|rekey)\b/i,
    reason: "writable PRAGMA is not permitted",
  },
];

export function guardStatement(sql: string): void {
  if (typeof sql !== "string") throw new Error("statement must be a string");
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("empty statement");
  if (trimmed.length > MAX_STMT_LEN)
    throw new Error(`statement too long (max ${MAX_STMT_LEN} bytes)`);
  for (const f of FORBIDDEN_PATTERNS) {
    if (f.re.test(trimmed)) throw new Error(f.reason);
  }
  // Audit_log is the integrity check on this route; refusing writes to it
  // prevents an admin from quietly editing their own history.
  if (/\b(update|delete|insert|drop|alter)\b[\s\S]*\baudit_log\b/i.test(trimmed)) {
    throw new Error("audit_log is read-only from this endpoint");
  }
}

export function isMutation(sql: string): boolean {
  const head = sql.trim().slice(0, 16).toUpperCase();
  return /^(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE)\b/.test(head);
}

interface ExecResult {
  rows: unknown[];
  columns: string[];
  rowsAffected: number;
  lastInsertRowid: number | null;
  elapsedMs: number;
  truncated: boolean;
}

function executeSql(db: Database, sql: string): ExecResult {
  const start = Date.now();
  if (isMutation(sql)) {
    // Use exec() variant that returns change count.
    const r = db.run(sql);
    return {
      rows: [],
      columns: [],
      rowsAffected: Number(r.changes ?? 0),
      lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
      elapsedMs: Date.now() - start,
      truncated: false,
    };
  }
  // SELECT / EXPLAIN / etc.
  const stmt = db.query(sql);
  const all = stmt.all() as unknown[];
  const truncated = all.length > MAX_ROWS;
  const rows = truncated ? all.slice(0, MAX_ROWS) : all;
  const columns =
    rows.length && typeof rows[0] === "object" && rows[0] !== null
      ? Object.keys(rows[0] as Record<string, unknown>)
      : [];
  return {
    rows,
    columns,
    rowsAffected: 0,
    lastInsertRowid: null,
    elapsedMs: Date.now() - start,
    truncated,
  };
}

function getRawDb(): Database {
  // Use the raw bun:sqlite handle directly. We deliberately bypass the
  // Drizzle wrapper here because this route runs arbitrary SQL — Drizzle's
  // typed API is not the right tool. Previously this used require() to dodge
  // an init-order cycle, but require() returns undefined under Bun ESM, so
  // every db/* call would crash with "undefined is not an object".
  return sqlite;
}

export const adminDbRoutes = new Elysia({ prefix: "/api/admin/db" })
  .derive(async ({ cookie, set }) => {
    const u = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!u || u.role !== "admin") {
      set.status = 401;
      return { __unauthorized: true as const, user: null };
    }
    return { __unauthorized: false as const, user: u };
  })
  .onBeforeHandle(({ __unauthorized }) => {
    if (__unauthorized) return { error: "Unauthorized", code: "UNAUTHORIZED" };
    return undefined;
  })

  // GET /api/admin/db/schema — list tables + columns. Used by Native Editor
  // and DB Editor sidebar both.
  .get("/schema", async () => {
    const db = getRawDb();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const out: Array<{ name: string; columns: unknown[] }> = [];
    for (const t of tables) {
      const cols = db.query(`PRAGMA table_info(${JSON.stringify(t.name).replace(/"/g, "")})`).all();
      out.push({ name: t.name, columns: cols });
    }
    return { tables: out };
  })

  // POST /api/admin/db/query — execute one SQL statement.
  .post(
    "/query",
    async ({ body, request, set, user }) => {
      // Raw-SQL console disabled by default. Operators must opt in explicitly
      // via env so a stolen admin cookie or XSS cannot trivially DROP TABLE.
      // The Native CRUD editor (admin-tables.ts) remains the supported tool.
      if (process.env.NEXORA_ENABLE_RAW_SQL !== "true") {
        set.status = 403;
        return {
          error:
            "Raw SQL console is disabled. Set NEXORA_ENABLE_RAW_SQL=true in the backend environment to enable; the Native Editor is the default path.",
          code: "RAW_SQL_DISABLED",
        };
      }
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-db-query:${ip}`, 30, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many queries", code: "RATE_LIMITED" };
      }
      const sql = body.statement;
      try {
        guardStatement(sql);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set.status = 400;
        // Log refusal too — useful for spotting accidental foot-guns.
        try {
          recordAudit(getRawDb(), {
            actorEmail: user?.email,
            actorIp: ip,
            action: "db.query.refused",
            statement: sql,
            success: false,
            error: msg,
          });
        } catch {
          /* ignore */
        }
        return { error: msg, code: "STATEMENT_REFUSED" };
      }
      const db = getRawDb();
      try {
        const r = executeSql(db, sql);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: isMutation(sql) ? "db.mutation" : "db.read",
          statement: sql,
          rowsAffected: r.rowsAffected,
          elapsedMs: r.elapsedMs,
          success: true,
        });
        return {
          ok: true,
          rows: r.rows,
          columns: r.columns,
          rowsAffected: r.rowsAffected,
          lastInsertRowid: r.lastInsertRowid,
          elapsedMs: r.elapsedMs,
          truncated: r.truncated,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "db.query.failed",
          statement: sql,
          success: false,
          error: msg,
        });
        set.status = 400;
        return { error: msg, code: "QUERY_FAILED" };
      }
    },
    {
      body: t.Object({
        statement: t.String({ maxLength: MAX_STMT_LEN }),
      }),
    },
  )

  // GET /api/admin/db/audit — paginated audit-log viewer.
  .get("/audit", async ({ query }) => {
    const db = getRawDb();
    const limit = Number(query?.limit ?? 100);
    const actor = typeof query?.actor === "string" ? query.actor : undefined;
    const action = typeof query?.action === "string" ? query.action : undefined;
    const since = query?.since ? Number(query.since) : undefined;
    const rows = readAudit(db, { limit, actor, action, since });
    return { rows };
  })

  // ====== Table CRUD (phpMyAdmin-style) ======

  // GET /api/admin/db/table/:name — paginated row listing with sort + count.
  .get("/table/:name", async ({ params, query, set }) => {
    const db = getRawDb();
    const name = validateTableName(params.name);
    if (!name) {
      set.status = 400;
      return { error: "Invalid table name", code: "BAD_TABLE" };
    }
    const limit = Math.min(Math.max(Number(query?.limit ?? 50), 1), 500);
    const offset = Math.max(Number(query?.offset ?? 0), 0);
    const orderCol = typeof query?.order === "string" ? query.order : null;
    const dir = query?.dir === "desc" ? "DESC" : "ASC";
    const q = typeof query?.q === "string" ? query.q.trim() : "";

    const cols = db.query(`PRAGMA table_info("${name}")`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;
    const colNames = new Set(cols.map((c) => c.name));
    const safeOrder = orderCol && colNames.has(orderCol) ? `"${orderCol}"` : "rowid";

    // Build optional LIKE filter across TEXT columns
    let whereSql = "";
    const whereArgs: unknown[] = [];
    if (q) {
      const textCols = cols.filter(
        (c) => /text|char|clob/i.test(c.type) || c.type === "" || /json/i.test(c.type),
      );
      if (textCols.length > 0) {
        const clauses = textCols.map((c) => `"${c.name}" LIKE ?`);
        whereSql = `WHERE ${clauses.join(" OR ")}`;
        const pat = `%${q}%`;
        for (let i = 0; i < textCols.length; i++) whereArgs.push(pat);
      }
    }

    const total = (
      db
        .query(`SELECT COUNT(*) AS n FROM "${name}" ${whereSql}`)
        .get(...(whereArgs as never[])) as {
        n: number;
      }
    ).n;
    const rows = db
      .query(
        `SELECT rowid AS _rowid, * FROM "${name}" ${whereSql} ORDER BY ${safeOrder} ${dir} LIMIT ? OFFSET ?`,
      )
      .all(...(whereArgs as never[]), limit, offset) as Array<Record<string, unknown>>;
    return { columns: cols, rows, total, limit, offset, q };
  })

  // POST /api/admin/db/table/:name/row — insert new row.
  .post(
    "/table/:name/row",
    async ({ params, body, request, set, user }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-db-write:${ip}`, 30, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many writes", code: "RATE_LIMITED" };
      }
      const db = getRawDb();
      const name = validateTableName(params.name);
      if (!name) {
        set.status = 400;
        return { error: "Invalid table name", code: "BAD_TABLE" };
      }
      const data = body?.data as Record<string, unknown>;
      if (!data || typeof data !== "object") {
        set.status = 400;
        return { error: "data object required", code: "BAD_BODY" };
      }
      const cols = db.query(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      const validKeys = Object.keys(data).filter((k) => colNames.has(k));
      if (validKeys.length === 0) {
        set.status = 400;
        return { error: "no valid columns in data", code: "BAD_BODY" };
      }
      const placeholders = validKeys.map(() => "?").join(", ");
      const colsList = validKeys.map((k) => `"${k}"`).join(", ");
      const sql = `INSERT INTO "${name}" (${colsList}) VALUES (${placeholders})`;
      const args = validKeys.map((k) => data[k]);
      const start = Date.now();
      try {
        const r = db.query(sql).run(...(args as never[]));
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "db.row.insert",
          target: name,
          statement: sql,
          rowsAffected: Number(r.changes ?? 0),
          elapsedMs: Date.now() - start,
          success: true,
        });
        return {
          ok: true,
          lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "db.row.insert.failed",
          target: name,
          statement: sql,
          success: false,
          error: msg,
        });
        set.status = 400;
        return { error: msg, code: "INSERT_FAILED" };
      }
    },
    { body: t.Object({ data: t.Record(t.String(), t.Any()) }) },
  )

  // PATCH /api/admin/db/table/:name/row — update row by rowid.
  .patch(
    "/table/:name/row",
    async ({ params, body, request, set, user }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-db-write:${ip}`, 30, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many writes", code: "RATE_LIMITED" };
      }
      const db = getRawDb();
      const name = validateTableName(params.name);
      if (!name) {
        set.status = 400;
        return { error: "Invalid table name", code: "BAD_TABLE" };
      }
      const rowid = Number(body?.rowid);
      const data = body?.data as Record<string, unknown>;
      if (!Number.isFinite(rowid) || !data || typeof data !== "object") {
        set.status = 400;
        return { error: "rowid and data required", code: "BAD_BODY" };
      }
      const cols = db.query(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      const validKeys = Object.keys(data).filter((k) => colNames.has(k));
      if (validKeys.length === 0) {
        set.status = 400;
        return { error: "no valid columns in data", code: "BAD_BODY" };
      }
      const setClause = validKeys.map((k) => `"${k}" = ?`).join(", ");
      const sql = `UPDATE "${name}" SET ${setClause} WHERE rowid = ?`;
      const args = [...validKeys.map((k) => data[k]), rowid];
      const start = Date.now();
      try {
        const r = db.query(sql).run(...(args as never[]));
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "db.row.update",
          target: `${name}#${rowid}`,
          statement: sql,
          rowsAffected: Number(r.changes ?? 0),
          elapsedMs: Date.now() - start,
          success: true,
        });
        return { ok: true, rowsAffected: Number(r.changes ?? 0) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "db.row.update.failed",
          target: `${name}#${rowid}`,
          statement: sql,
          success: false,
          error: msg,
        });
        set.status = 400;
        return { error: msg, code: "UPDATE_FAILED" };
      }
    },
    { body: t.Object({ rowid: t.Number(), data: t.Record(t.String(), t.Any()) }) },
  )

  // DELETE /api/admin/db/table/:name/row — delete row by rowid.
  .delete(
    "/table/:name/row",
    async ({ params, body, request, set, user }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-db-write:${ip}`, 30, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many writes", code: "RATE_LIMITED" };
      }
      const db = getRawDb();
      const name = validateTableName(params.name);
      if (!name) {
        set.status = 400;
        return { error: "Invalid table name", code: "BAD_TABLE" };
      }
      // Accept either single { rowid } or bulk { rowids: [..] }
      const rawRowids = Array.isArray(body?.rowids)
        ? (body.rowids as unknown[])
        : body?.rowid != null
          ? [body.rowid]
          : [];
      const rowids = rawRowids.map((r) => Number(r)).filter((n) => Number.isFinite(n));
      if (rowids.length === 0) {
        set.status = 400;
        return { error: "rowid or rowids required", code: "BAD_BODY" };
      }
      if (rowids.length > 500) {
        set.status = 400;
        return { error: "max 500 rows per bulk delete", code: "TOO_MANY" };
      }
      const placeholders = rowids.map(() => "?").join(",");
      const sql = `DELETE FROM "${name}" WHERE rowid IN (${placeholders})`;
      const start = Date.now();
      try {
        const r = db.query(sql).run(...(rowids as never[]));
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: rowids.length > 1 ? "db.row.delete.bulk" : "db.row.delete",
          target: `${name}#${rowids.length > 1 ? `${rowids.length} rows` : rowids[0]}`,
          statement: sql,
          rowsAffected: Number(r.changes ?? 0),
          elapsedMs: Date.now() - start,
          success: true,
        });
        return { ok: true, rowsAffected: Number(r.changes ?? 0) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "db.row.delete.failed",
          target: `${name}#${rowids.length} rows`,
          statement: sql,
          success: false,
          error: msg,
        });
        set.status = 400;
        return { error: msg, code: "DELETE_FAILED" };
      }
    },
    {
      body: t.Object({
        rowid: t.Optional(t.Number()),
        rowids: t.Optional(t.Array(t.Number())),
      }),
    },
  );

// Whitelist a table name to a safe identifier or reject.
export function validateTableName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return null;
  if (raw.startsWith("sqlite_") || raw === "_migrations" || raw === "audit_log") return null;
  return raw;
}
