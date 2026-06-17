-- 0007_session_metadata.sql
--
-- Capture per-session metadata so the admin Profile UI can render an
-- accurate "logged in devices" list and let the operator revoke a single
-- suspicious session knowing where it came from. Sellauth and Whop both
-- surface IP + UA + first/last-seen timestamps on their "Logged in
-- devices" panels — that's the SOC2 / ISO 27001 baseline most enterprise
-- self-host buyers expect.
--
-- ip_address: best-effort client IP captured at createSession() time.
--   Stored as text so v6 fits without conversion. NULL for pre-migration
--   rows; UI displays "Unknown" for that case.
-- user_agent: raw User-Agent header truncated to 500 chars at the app
--   layer so a pathological header can't bloat the row.
-- last_ip: refreshed alongside last_seen_at so a session that roams
--   between networks (mobile -> wifi) shows where it most recently
--   resurfaced, not just where it started.
--
-- All three default NULL so existing sessions keep validating until
-- they roll over naturally; the next createSession() populates the
-- columns up-front.

ALTER TABLE sessions ADD COLUMN ip_address TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN last_ip TEXT;