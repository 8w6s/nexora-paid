import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const dbPath = resolve(import.meta.dir, "..", "backend", "sqlite.db");
const db = new Database(dbPath);

const TEST_SLUGS = ["a", "test-product"];
const placeholders = TEST_SLUGS.map(() => "?").join(",");
const found = db
  .prepare(`SELECT id, slug, name, sold FROM products WHERE slug IN (${placeholders})`)
  .all(...TEST_SLUGS) as Array<{ id: string; slug: string; name: string; sold: number }>;

console.log("Found:", JSON.stringify(found, null, 2));

for (const r of found) {
  if (r.sold === 0) {
    db.prepare("DELETE FROM product_keys WHERE product_id = ?").run(r.id);
    db.prepare("DELETE FROM products WHERE id = ?").run(r.id);
    console.log("Deleted:", r.slug);
  } else {
    console.log("Skip (has sales):", r.slug, "sold=", r.sold);
  }
}

db.close();