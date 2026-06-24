-- Promote the audit_log table from on-demand creation (via
-- ensureAuditTable in lib/audit-log.ts) to a real tracked migration.
--
-- The lazy CREATE TABLE IF NOT EXISTS path stays in audit-log.ts as a
-- safety net for fresh databases, but going through the migration
-- gives us a paper trail and lets future schema tweaks (column adds,
-- new indexes) ride the normal migrator instead of mutating the
-- helper function and hoping every entry point calls it.
--
-- Shape must match audit-log.ts exactly — drift here breaks INSERT.

CREATE TABLE IF NOT EXISTS audit_log (
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
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_email, at DESC);

-- New in 0011: an index on action+at so the DB-Editor pane's "show me
-- every db.mutation in the last hour" query doesn't full-scan once
-- the table grows past a few months of admin activity.
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action, at DESC);