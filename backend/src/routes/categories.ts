import { count, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db/connection.ts";
import { categories, products } from "../db/schema.ts";

/**
 * Public category routes — hierarchical category tree with product counts.
 * Falls back to legacy string-based categories if the tree is empty.
 */
export const categoryRoutes = new Elysia().get("/api/categories", async () => {
  const cats = await db.select().from(categories).orderBy(categories.sortOrder, categories.name);
  if (cats.length === 0) {
    // Fallback: legacy free-text categories from products table
    const rows = await db
      .select({ category: products.category, c: count() })
      .from(products)
      .where(eq(products.active, true))
      .groupBy(products.category);
    return rows.map((r) => ({
      id: null as string | null,
      name: r.category,
      slug: r.category,
      parentId: null as string | null,
      count: Number(r.c),
    }));
  }
  const counts = await db
    .select({ categoryId: products.categoryId, c: count() })
    .from(products)
    .where(eq(products.active, true))
    .groupBy(products.categoryId);
  const countMap: Record<string, number> = {};
  for (const r of counts) if (r.categoryId) countMap[r.categoryId] = Number(r.c);
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    parentId: c.parentId,
    count: countMap[c.id] ?? 0,
  }));
});
