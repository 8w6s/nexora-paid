-- Migration 0001: Product Variants & Key Types

CREATE TABLE IF NOT EXISTS `__plugin_migrations` (
  `plugin_id` text NOT NULL,
  `idx` integer NOT NULL,
  `applied_at` integer NOT NULL,
  PRIMARY KEY(`plugin_id`, `idx`)
);

CREATE TABLE IF NOT EXISTS `product_variants` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `name` text NOT NULL,
  `price_usd` real NOT NULL DEFAULT 0,
  `compare_at_price` real,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `product_variants_product_idx` ON `product_variants` (`product_id`);

ALTER TABLE `products` ADD COLUMN `compare_at_price` real;

ALTER TABLE `product_keys` ADD COLUMN `variant_id` text REFERENCES `product_variants`(`id`) ON DELETE CASCADE;
ALTER TABLE `product_keys` ADD COLUMN `key_type` text NOT NULL DEFAULT 'code';
