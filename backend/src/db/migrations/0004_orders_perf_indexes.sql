-- 0004_orders_perf_indexes.sql
--
-- Add indexes that back the hot admin/customer order queries.
--
-- Without these, every admin orders/stats page load and every customer
-- "my orders" view runs a full scan + filesort on the orders table. At 100k
-- rows that's ~50MB streamed and hundreds of ms of CPU per request.
--
-- - orders_created_idx: backs "ORDER BY createdAt DESC" used by the admin
--   orders list, /api/admin/stats day-bucket aggregation, and the recent
--   invoices widget.
-- - orders_email_idx:   backs the user-by-email lookup in admin user-detail.
- - orders_user_created_idx: composite for the customer "my orders" page
--   which filters by userId and sorts by createdAt.

CREATE INDEX IF NOT EXISTS orders_created_idx
  ON orders (created_at);

CREATE INDEX IF NOT EXISTS orders_email_idx
  ON orders (email);

CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON orders (user_id, created_at);