-- 0009_password_resets.sql
-- Customer password reset flow. Stores only sha256(token) so a DB
-- leak cannot mint working reset links. Single-use via used_at,
-- 1h TTL via expires_at, both enforced at the route layer.

CREATE TABLE password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  ip_address TEXT
);

CREATE INDEX password_resets_user_idx ON password_resets (user_id);
CREATE INDEX password_resets_expires_idx ON password_resets (expires_at);