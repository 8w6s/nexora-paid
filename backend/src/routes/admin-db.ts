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
import { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { clientIp, rateLimitCheck } from "../lib/rate-limit.ts";
import { recordAudit, readAudit } from "../lib/audit-log.ts";

const MAX_STMT_LEN = 64 * 1024;
const MAX_ROWS = 5000;

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\battach\s+database\b/i, reason: "ATTACH DATABASE is not permitted" },
  { re: /\bdetach\s+database\b/i, reason: "DETACH DATABASE is not permitted" },
  { re: /load_extension\s*\(/i, reason: "load_extension() is not permitted" },
  { re: /\bpragma\s+(journal_mode|locking_mode|foreign_keys|key|rekey)\b/i, reason: "writable PRAGMA is not permitted" },
];

function guardStatement(sql: string): void {
  if (typeof sql !== "string") throw new Error("statement must be a string");
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("empty statement");
  if (trimmed.length > MAX_STMT_LEN) throw new Error(`statement too long (max ${MAX_STMT_LEN} bytes)`);
  for (const f of FORBIDDEN_PATTERNS) {
    if (f.re.test(trimmed)) throw new Error(f.reason);
  }
  // Audit_log is the integrity check on this route; refusing writes to it
  // prevents an admin from quietly editing their own history.
  if (/\b(update|delete|insert|drop|alter)\b[\s\S]*\baudit_log\b/i.test(trimmed)) {
    throw new Error("audit_log is read-only from this endpoint");
  }
}

function isMutation(sql: string): boolean {
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
  const columns = rows.length && typeof rows[0] === "object" && rows[0] !== null
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
  // The Drizzle wrapper hides the bun:sqlite handle; reach for it via the
  // module that created it. We import lazily to avoid an init-order cycle.
  // connection.ts exports `db` (Drizzle) — the underlying Database lives
  // on db.$client (Drizzle's escape hatch).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../db/connection.ts") as { db: { $client: Database } };
  return mod.db.$client;
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
  })

  // GET /api/admin/db/schema — list tables + columns. Used by Native Editor
  // and DB Editor sidebar both.
  .get("/schema", async () => {
    const db = getRawDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
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
        } catch { /* ignore */ }
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
  });