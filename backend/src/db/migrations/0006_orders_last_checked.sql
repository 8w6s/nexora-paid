-- 0006_orders_last_checked.sql
--
-- Per-order LTC explorer poll tracking. Without this column, every watcher
-- tick re-polls every payable order indiscriminately, exhausting the keyless
-- BlockCypher quota (~200/hr) once the payable backlog crosses ~90 orders.
-- The watcher now prioritises by oldest-checked first within the per-tick
-- quota budget; recently-checked addresses get skipped until their cooldown
-- elapses.
--
-- New rows default to 0 so the first tick after deploy treats existing
-- payable orders as the highest priority (they have never been checked
-- against this column, even though most of them have been polled before).
-- This is the intentional behaviour: a single full sweep on first deploy
-- then steady-state prioritisation thereafter.

ALTER TABLE orders ADD COLUMN last_checked_at INTEGER NOT NULL DEFAULT 0;

-- Composite (status, last_checked_at) supports the watcher's
--   WHERE status IN ('pending','awaiting_payment','underpaid')
--   ORDER BY last_checked_at ASC LIMIT N
-- without a filesort.
CREATE INDEX IF NOT EXISTS orders_status_checked_idx
  ON orders (status, last_checked_at);