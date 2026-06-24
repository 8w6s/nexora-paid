-- 0005_session_last_seen.sql
--
-- Add idle timeout tracking + index to sessions.
--
-- Without lastSeenAt the only timeout is the absolute 30-day expiresAt — a
-- stolen cookie that the legitimate user never notices stays valid for 30
-- days no matter how long it sits idle. Tracking lastSeenAt lets validateSession()
-- evict idle sessions earlier (24h customer / 1h admin in lib/auth.ts) which
-- is the SOC2 / ISO 27001 baseline most enterprise self-host buyers expect.
--
-- The lastSeenIdx supports the periodic "delete from sessions where
-- lastSeenAt < cutoff" sweep without a full table scan.

ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing rows get lastSeenAt = createdAt so the idle-timeout
-- doesn't immediately evict every active session on the first deploy.
UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at = 0;

CREATE INDEX IF NOT EXISTS sessions_last_seen_idx
  ON sessions (last_seen_at);