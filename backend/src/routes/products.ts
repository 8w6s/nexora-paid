import { and, asc, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db/connection.ts";
import { productKeys, products, productVariants } from "../db/schema.ts";

// Cap user-controlled search term to a sane length and strip SQL LIKE meta
// chars so q="%" doesn't return the entire catalog. Same hardening as the
// suggest plugin.
const MAX_PUBLIC_QUERY = 80;
const WILDCARD_ONLY = /^[%_\s]+$/;
// Escape SQL LIKE meta-chars in user input. We strip backslashes (so an
// attacker can't pre-emptively cancel our escaping) then escape `%` and `_`.
const BACKSLASH = String.fromCharCode(92);
const escapeLike = (s: string) =>
  s.split(BACKSLASH).join("").replace(/%/g, `${BACKSLASH}%`).replace(/_/g, `${BACKSLASH}_`);
const PRODUCT_SORTS = new Set(["price-asc", "price-desc", "best", "name", "newest"]);

/**
 * Public product catalog routes — search, filter, sort, detail.
 * Stock is derived from product_keys, never stored.
 */

/* available-key count per product (where variantId is null, i.e., simple products) */
async function stockMap(productIds: string[]): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .select({ productId: productKeys.productId, c: count() })
    .from(productKeys)
    .where(and(inArray(productKeys.productId, productIds), eq(productKeys.status, "available")))
    .groupBy(productKeys.productId);
  const m: Record<string, number> = {};
  for (const r of rows) m[r.productId] = Number(r.c);
  return m;
}

export const productRoutes = new Elysia()
  /* ───── Public catalog: search + filter + sort (stock from product_keys) ───── */
  .get("/api/products", async ({ query }) => {
    const q = query as Record<string, string>;
    const conds = [eq(products.active, true)];
    if (q.category && q.category !== "All" && q.category.length <= 80) {
      conds.push(eq(products.category, q.category));
    }
    if (q.q?.trim()) {
      const raw = q.q.slice(0, MAX_PUBLIC_QUERY).trim();
      if (!WILDCARD_ONLY.test(raw)) {
        // Escape SQL LIKE meta chars so user input can't be a wildcard.
        const term = `%${escapeLike(raw)}%`;
        conds.push(or(like(products.name, term), like(products.description, term))!);
      }
    }
    // Sort: newest (default), price-asc, price-desc, best-selling, name.
    // Validate against allowlist so a hostile sort= doesn't crash drizzle.
    const sort = PRODUCT_SORTS.has(q.sort) ? q.sort : "newest";
    const order =
      sort === "price-asc"
        ? asc(products.priceUsd)
        : sort === "price-desc"
          ? desc(products.priceUsd)
          : sort === "best"
            ? desc(products.sold)
            : sort === "name"
              ? asc(products.name)
              : desc(products.createdAt);

    const rows = await db
      .select()
      .from(products)
      .where(and(...conds))
      .orderBy(order);
    const productIds = rows.map((p) => p.id);
    const stock = await stockMap(productIds);

    // Fetch variants for all these products
    const allVariants =
      productIds.length > 0
        ? await db
            .select()
            .from(productVariants)
            .where(inArray(productVariants.productId, productIds))
        : [];

    // Fetch key counts grouped by variantId
    const variantStockRows =
      productIds.length > 0
        ? await db
            .select({ variantId: productKeys.variantId, c: count() })
            .from(productKeys)
            .where(
              and(inArray(productKeys.productId, productIds), eq(productKeys.status, "available")),
            )
            .groupBy(productKeys.variantId)
        : [];
    const variantStock: Record<string, number> = {};
    for (const r of variantStockRows) {
      if (r.variantId) variantStock[r.variantId] = Number(r.c);
    }

    // Map variants to products
    const variantsByProduct: Record<string, any[]> = {};
    for (const v of allVariants) {
      const vStock = variantStock[v.id] ?? 0;
      (variantsByProduct[v.productId] ??= []).push({
        ...v,
        stock: vStock,
        inStock: vStock > 0,
      });
    }

    let out = rows.map((p) => {
      const pVariants = variantsByProduct[p.id] ?? [];
      const hasVariants = pVariants.length > 0;
      const pStock = hasVariants
        ? pVariants.reduce((sum, v) => sum + v.stock, 0)
        : (stock[p.id] ?? 0);
      return {
        ...p,
        variants: pVariants,
        stock: pStock,
        inStock: pStock > 0,
      };
    });

    if (q.inStock === "true") out = out.filter((p) => p.inStock); // in-stock-only filter
    return out;
  })

  .get("/api/products/:idOrSlug", async ({ params: { idOrSlug }, set }) => {
    let row = (await db.select().from(products).where(eq(products.slug, idOrSlug)))[0];
    if (!row) row = (await db.select().from(products).where(eq(products.id, idOrSlug)))[0];
    if (!row?.active) {
      set.status = 404;
      return { error: "Product not found", code: "NOT_FOUND" };
    }

    const variantsList = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, row.id));
    const variantStockRows = await db
      .select({ variantId: productKeys.variantId, c: count() })
      .from(productKeys)
      .where(and(eq(productKeys.productId, row.id), eq(productKeys.status, "available")))
      .groupBy(productKeys.variantId);

    const variantStock: Record<string, number> = {};
    for (const r of variantStockRows) {
      if (r.variantId) variantStock[r.variantId] = Number(r.c);
    }

    const variants = variantsList.map((v) => ({
      ...v,
      stock: variantStock[v.id] ?? 0,
      inStock: (variantStock[v.id] ?? 0) > 0,
    }));

    const stock = await stockMap([row.id]);
    const totalStock =
      variants.length > 0 ? variants.reduce((sum, v) => sum + v.stock, 0) : (stock[row.id] ?? 0);

    return {
      ...row,
      variants,
      stock: totalStock,
      inStock: totalStock > 0,
    };
  });
