/**
 * Audit log — append-only record of admin-side mutations.
 *
 * Every privileged write the admin (or a power-user with admin role) issues
 * should land here before it touches business tables. The DB Editor in
 * particular MUST log every SQL it executes, with the actor's email, IP,
 * the statement text (truncated), affected row count, and elapsed time.
 *
 * We deliberately keep this in a separate table with no FK back to users —
 * if a user is later deleted we still want their audit history intact.
 */
import { Database } from "bun:sqlite";

let initialized = false;

export function ensureAuditTable(db: Database): void {
  if (initialized) return;
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    actor_email TEXT,
    actor_ip TEXT,
    action TEXT NOT NULL,
    target TEXT,
    statement TEXT,
    rows_affected INTEGER,
    elapsed_ms INTEGER,
    success INTEGER NOT NULL DEFAULT 1,
    error TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log(at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_email, at DESC)`);
  initialized = true;
}

export interface AuditEntry {
  actorEmail?: string | null;
  actorIp?: string | null;
  action: string;
  target?: string | null;
  statement?: string | null;
  rowsAffected?: number | null;
  elapsedMs?: number | null;
  success?: boolean;
  error?: string | null;
}

const MAX_STMT = 4000;

export function recordAudit(db: Database, entry: AuditEntry): void {
  ensureAuditTable(db);
  const stmt = entry.statement && entry.statement.length > MAX_STMT
    ? entry.statement.slice(0, MAX_STMT) + "…[truncated]"
    : entry.statement ?? null;
  db.query(
    `INSERT INTO audit_log
       (actor_email, actor_ip, action, target, statement, rows_affected, elapsed_ms, success, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.actorEmail ?? null,
    entry.actorIp ?? null,
    entry.action,
    entry.target ?? null,
    stmt,
    entry.rowsAffected ?? null,
    entry.elapsedMs ?? null,
    entry.success === false ? 0 : 1,
    entry.error ?? null,
  );
}

export interface AuditQuery {
  limit?: number;
  actor?: string;
  action?: string;
  since?: number;
}

export function readAudit(db: Database, q: AuditQuery = {}): unknown[] {
  ensureAuditTable(db);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.actor) { where.push("actor_email = ?"); args.push(q.actor); }
  if (q.action) { where.push("action = ?"); args.push(q.action); }
  if (q.since) { where.push("at >= ?"); args.push(q.since); }
  const sql = `SELECT id, at, actor_email, actor_ip, action, target, statement,
                      rows_affected, elapsed_ms, success, error
               FROM audit_log
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY at DESC LIMIT ?`;
  args.push(limit);
  return db.query(sql).all(...args);
}