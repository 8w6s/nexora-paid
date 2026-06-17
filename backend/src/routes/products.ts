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

/**
 * One-shot stock query covering BOTH product-level and variant-level keys for
 * a set of products. Replaces the old pattern of two separate groupBy queries
 * (stockMap by productId, then by variantId). The product_keys_product_status_idx
 * is hit once instead of twice. Result groups by (productId, variantId|null).
 */
async function stockMapCombined(productIds: string[]): Promise<{
  byProduct: Record<string, number>;
  byVariant: Record<string, number>;
}> {
  if (productIds.length === 0) return { byProduct: {}, byVariant: {} };
  const rows = await db
    .select({
      productId: productKeys.productId,
      variantId: productKeys.variantId,
      c: count(),
    })
    .from(productKeys)
    .where(and(inArray(productKeys.productId, productIds), eq(productKeys.status, "available")))
    .groupBy(productKeys.productId, productKeys.variantId);
  const byProduct: Record<string, number> = {};
  const byVariant: Record<string, number> = {};
  for (const r of rows) {
    if (r.variantId) byVariant[r.variantId] = Number(r.c);
    else byProduct[r.productId] = Number(r.c);
  }
  return { byProduct, byVariant };
}

// Catalog list cache. Stock-aware queries change infrequently relative to read
// volume, so even a 5-second TTL gives a huge hit ratio on the storefront
// homepage. Keyed by the full canonicalised query string so each filter set
// gets its own slot. The watcher's deliver hook clears this when stock moves.
const catalogCache = new Map<string, { payload: any[]; expiresAt: number }>();
const CATALOG_CACHE_TTL_MS = 5_000;
export function clearCatalogCache(): void {
  catalogCache.clear();
}

export const productRoutes = new Elysia()
  /* ───── Public catalog: search + filter + sort (stock from product_keys) ───── */
  .get("/api/products", async ({ query, set }) => {
    const q = query as Record<string, string>;

    // Pagination: default 24, max 60. Storefront grids show 12-24 per page,
    // so 60 is a generous max for power-user filtering. Without this, an
    // unbounded /api/products on a 5k-SKU catalog ships multi-MB JSON on
    // every page load.
    const limitRaw = Number.parseInt(q.limit ?? "24", 10);
    const offsetRaw = Number.parseInt(q.offset ?? "0", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 60) : 24;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    // Cache key: canonicalise the inputs so identical queries hit the same slot.
    const cacheKey = JSON.stringify({
      cat: q.category ?? null,
      q: q.q?.trim() ?? null,
      sort: q.sort ?? null,
      inStock: q.inStock ?? null,
      limit,
      offset,
    });
    const cached = catalogCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // Tell intermediaries the response is fresh enough to reuse for a few
      // seconds. ETag-style validators would be even better but for a 5s TTL
      // the gain isn't worth the complexity.
      set.headers["Cache-Control"] = "public, max-age=5";
      return cached.payload;
    }

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
      .orderBy(order)
      .limit(limit)
      .offset(offset);

    const productIds = rows.map((p) => p.id);

    // Single combined stock query — replaces two separate groupBy passes.
    const { byProduct: stock, byVariant: variantStock } = await stockMapCombined(productIds);

    // Fetch variants for all these products in one shot.
    const allVariants =
      productIds.length > 0
        ? await db
            .select()
            .from(productVariants)
            .where(inArray(productVariants.productId, productIds))
        : [];

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

    catalogCache.set(cacheKey, { payload: out, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
    set.headers["Cache-Control"] = "public, max-age=5";
    return out;
  })

  .get("/api/products/:idOrSlug", async ({ params: { idOrSlug }, set }) => {
    // Single query with OR instead of two sequential selects on miss. The slug
    // lookup is the common path; the id fallback covers admin links.
    const row = (
      await db
        .select()
        .from(products)
        .where(or(eq(products.slug, idOrSlug), eq(products.id, idOrSlug))!)
        .limit(1)
    )[0];
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
