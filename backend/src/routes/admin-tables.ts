/**
 * Native table CRUD — the no-SQL backend for AdminNativeEditor.
 *
 * Audience: admin customer who doesn't want to write SQL. Generic per-table
 * CRUD driven by SQLite's PRAGMA table_info. Every mutation goes through
 * audit_log just like admin-db.
 *
 * Path safety: table names are taken from sqlite_master and re-checked on
 * every request. We never interpolate user-supplied strings into SQL except
 * after whitelisting against the live schema.
 *
 * Why a separate route from admin-db?
 *   admin-db is the power-user SQL console. This one is for non-technical
 *   admins (the "no-SQL" track of the spec). Same security model but with
 *   much smaller blast radius per request.
 */
import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import { recordAudit } from "../lib/audit-log.ts";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { degradedGate } from "../lib/integrity-state.ts";
import { clientIp, rateLimitCheck } from "../lib/rate-limit.ts";

const PAGE_MAX = 200;

interface ColInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

function getRawDb(): Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../db/connection.ts") as { db: { $client: Database } };
  return mod.db.$client;
}

/** Whitelist a table name against sqlite_master. Throws on miss. */
function assertTable(db: Database, name: string): void {
  const r = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
    .get(name) as { 1: number } | null;
  if (!r) throw new Error(`unknown table: ${name}`);
  if (name === "audit_log") {
    // audit_log is owned by the audit machinery; native CRUD must not edit it.
    throw new Error("audit_log is read-only");
  }
}

function tableColumns(db: Database, name: string): ColInfo[] {
  // PRAGMA table_info doesn't accept bound params, so we wrap the (already
  // whitelisted) name in double-quotes and strip any stray quotes for safety.
  const safe = name.replace(/"/g, "");
  return db.query(`PRAGMA table_info("${safe}")`).all() as ColInfo[];
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** Coerce JSON payload values to types SQLite accepts; rejects unknown keys. */
function pickPayload(cols: ColInfo[], body: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(cols.map((c) => c.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k)) throw new Error(`unknown column: ${k}`);
    if (v === undefined) continue;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
    } else {
      // Object / array → JSON-stringify so callers can round-trip JSON columns.
      out[k] = JSON.stringify(v);
    }
  }
  return out;
}

function pkColumn(cols: ColInfo[]): string {
  const pk = cols.find((c) => c.pk > 0);
  if (!pk) throw new Error("table has no primary key — refusing to update by-id");
  return pk.name;
}

export const adminTablesRoutes = new Elysia({ prefix: "/api/admin/tables" })
  .derive(async ({ cookie, set }) => {
    const u = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (u?.role !== "admin") {
      set.status = 401;
      return { __unauthorized: true as const, user: null };
    }
    return { __unauthorized: false as const, user: u };
  })
  .onBeforeHandle(({ __unauthorized }) => {
    if (__unauthorized) return { error: "Unauthorized", code: "UNAUTHORIZED" };
    return undefined;
  })
  .onBeforeHandle(degradedGate)

  // GET /api/admin/tables/:name/rows?limit=50&offset=0
  .get("/:name/rows", async ({ params, query, set }) => {
    const db = getRawDb();
    try {
      assertTable(db, params.name);
    } catch (e) {
      set.status = 404;
      return { error: e instanceof Error ? e.message : String(e), code: "UNKNOWN_TABLE" };
    }
    const cols = tableColumns(db, params.name);
    const limit = Math.min(Math.max(Number(query?.limit ?? 50), 1), PAGE_MAX);
    const offset = Math.max(Number(query?.offset ?? 0), 0);
    const total = (
      db.query(`SELECT COUNT(*) AS c FROM ${quoteIdent(params.name)}`).get() as { c: number }
    ).c;
    const rows = db
      .query(`SELECT * FROM ${quoteIdent(params.name)} LIMIT ? OFFSET ?`)
      .all(limit, offset);
    return { columns: cols, rows, total, limit, offset };
  })

  // POST /api/admin/tables/:name/rows  body = column-value map
  .post(
    "/:name/rows",
    async ({ params, body, request, set, user }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-tables-write:${ip}`, 60, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many writes", code: "RATE_LIMITED" };
      }
      const db = getRawDb();
      try {
        assertTable(db, params.name);
      } catch (e) {
        set.status = 404;
        return { error: e instanceof Error ? e.message : String(e), code: "UNKNOWN_TABLE" };
      }
      const cols = tableColumns(db, params.name);
      let payload: Record<string, unknown>;
      try {
        payload = pickPayload(cols, body as Record<string, unknown>);
      } catch (e) {
        set.status = 400;
        return { error: e instanceof Error ? e.message : String(e), code: "BAD_PAYLOAD" };
      }
      if (Object.keys(payload).length === 0) {
        set.status = 400;
        return { error: "empty payload", code: "BAD_PAYLOAD" };
      }
      const keys = Object.keys(payload);
      const sql = `INSERT INTO ${quoteIdent(params.name)} (${keys.map(quoteIdent).join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
      const start = Date.now();
      try {
        const r = db.query(sql).run(...keys.map((k) => payload[k] as never));
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "table.insert",
          target: params.name,
          statement: sql,
          rowsAffected: Number(r.changes ?? 0),
          elapsedMs: Date.now() - start,
          success: true,
        });
        return {
          ok: true,
          lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
          changes: Number(r.changes ?? 0),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "table.insert.failed",
          target: params.name,
          statement: sql,
          elapsedMs: Date.now() - start,
          success: false,
          error: msg,
        });
        set.status = 400;
        return { error: msg, code: "INSERT_FAILED" };
      }
    },
    { body: t.Record(t.String(), t.Any()) },
  )

  // PATCH /api/admin/tables/:name/rows/:id  body = partial column-value map
  .patch(
    "/:name/rows/:id",
    async ({ params, body, request, set, user }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-tables-write:${ip}`, 60, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many writes", code: "RATE_LIMITED" };
      }
      const db = getRawDb();
      try {
        assertTable(db, params.name);
      } catch (e) {
        set.status = 404;
        return { error: e instanceof Error ? e.message : String(e), code: "UNKNOWN_TABLE" };
      }
      const cols = tableColumns(db, params.name);
      const pk = pkColumn(cols);
      let payload: Record<string, unknown>;
      try {
        payload = pickPayload(cols, body as Record<string, unknown>);
      } catch (e) {
        set.status = 400;
        return { error: e instanceof Error ? e.message : String(e), code: "BAD_PAYLOAD" };
      }
      if (Object.keys(payload).length === 0) {
        set.status = 400;
        return { error: "empty payload", code: "BAD_PAYLOAD" };
      }
      const keys = Object.keys(payload);
      const setClause = keys.map((k) => `${quoteIdent(k)} = ?`).join(", ");
      const sql = `UPDATE ${quoteIdent(params.name)} SET ${setClause} WHERE ${quoteIdent(pk)} = ?`;
      const start = Date.now();
      try {
        const r = db.query(sql).run(...keys.map((k) => payload[k] as never), params.id as never);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "table.update",
          target: `${params.name}#${params.id}`,
          statement: sql,
          rowsAffected: Number(r.changes ?? 0),
          elapsedMs: Date.now() - start,
          success: true,
        });
        return { ok: true, changes: Number(r.changes ?? 0) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        recordAudit(db, {
          actorEmail: user?.email,
          actorIp: ip,
          action: "table.update.failed",
          target: `${params.name}#${params.id}`,
          statement: sql,
          elapsedMs: Date.now() - start,
          success: false,
          error: msg,
        });
        set.status = 400;
        return { error: msg, code: "UPDATE_FAILED" };
      }
    },
    { body: t.Record(t.String(), t.Any()) },
  )

  // DELETE /api/admin/tables/:name/rows/:id
  .delete("/:name/rows/:id", async ({ params, request, set, user }) => {
    const ip = clientIp(request);
    const rl = rateLimitCheck(`admin-tables-write:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      set.status = 429;
      return { error: "Too many writes", code: "RATE_LIMITED" };
    }
    const db = getRawDb();
    try {
      assertTable(db, params.name);
    } catch (e) {
      set.status = 404;
      return { error: e instanceof Error ? e.message : String(e), code: "UNKNOWN_TABLE" };
    }
    const cols = tableColumns(db, params.name);
    const pk = pkColumn(cols);
    const sql = `DELETE FROM ${quoteIdent(params.name)} WHERE ${quoteIdent(pk)} = ?`;
    const start = Date.now();
    try {
      const r = db.query(sql).run(params.id as never);
      recordAudit(db, {
        actorEmail: user?.email,
        actorIp: ip,
        action: "table.delete",
        target: `${params.name}#${params.id}`,
        statement: sql,
        rowsAffected: Number(r.changes ?? 0),
        elapsedMs: Date.now() - start,
        success: true,
      });
      return { ok: true, changes: Number(r.changes ?? 0) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordAudit(db, {
        actorEmail: user?.email,
        actorIp: ip,
        action: "table.delete.failed",
        target: `${params.name}#${params.id}`,
        statement: sql,
        elapsedMs: Date.now() - start,
        success: false,
        error: msg,
      });
      set.status = 400;
      return { error: msg, code: "DELETE_FAILED" };
    }
  });
