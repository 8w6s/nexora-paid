-- Backfill the categories table from the legacy products.category text
-- column. Shops seeded before the categorical schema (or via the old seed
-- script that only filled products.category) end up with an empty
-- `categories` table and every product.category_id NULL — which makes
-- the admin product editor's category dropdown empty and forces the
-- storefront onto its fallback path that returns id:null.
--
-- Idempotency: guarded by NOT EXISTS so re-applying on a shop that
-- already has categories is a no-op; the migrator's _migrations table
-- still keeps us from running twice in any case.

INSERT INTO categories (id, parent_id, name, slug, description, image, sort_order, created_at)
SELECT
  lower(hex(randomblob(16))),
  NULL,
  category,
  lower(replace(replace(category, ' ', '-'), '_', '-')),
  '',
  '',
  0,
  (unixepoch() * 1000)
FROM (
  SELECT DISTINCT category
  FROM products
  WHERE category IS NOT NULL AND category != ''
)
WHERE NOT EXISTS (SELECT 1 FROM categories);

UPDATE products
SET category_id = (
  SELECT c.id FROM categories c WHERE c.name = products.category LIMIT 1
)
WHERE products.category_id IS NULL
  AND products.category IS NOT NULL
  AND products.category != '';