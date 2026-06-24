-- 0008_blocklist.sql
--
-- Anti-fraud blocklist + allowlist. Both modes share one table since the
-- shape is identical (type, value, note, timestamp); a `mode` column with
-- a CHECK constraint disambiguates without splitting the storage.
--
-- The frontend's AdminBlacklist tab has been calling /api/admin/blacklist
-- and /api/admin/whitelist for a while but the backend routes never
-- existed — every POST/DELETE 404'd silently and the list always rendered
-- empty. This migration + the matching routes close that gap.
--
-- type:
--   email/ip: exact-match string compare at checkout time
--   country : ISO 3166-1 alpha-2 matched against geoip lookup
--   vpn     : synthetic — matches when the geoip provider flags the IP
--             as a known VPN/proxy/datacenter
--
-- value is normalised at the route layer (lowercased for email, uppercased
-- and clamped to 2 chars for country) so the UNIQUE on (mode,type,value)
-- collapses Foo@Example.com vs foo@example.com instead of letting both in.

CREATE TABLE blocklist (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('blacklist', 'whitelist')),
  type TEXT NOT NULL CHECK (type IN ('email', 'ip', 'country', 'vpn')),
  value TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX blocklist_mode_type_value_unique
  ON blocklist (mode, type, value);

-- Hot path at checkout: WHERE mode = 'blacklist' AND type IN (...).
-- The composite supports the (mode, type) prefix lookup without a scan.
CREATE INDEX blocklist_mode_type_idx ON blocklist (mode, type);