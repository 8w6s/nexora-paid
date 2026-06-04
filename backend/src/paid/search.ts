/**
 * Paid module: storefront autocomplete suggestions.
 *
 * Registers `GET /api/products/suggest?q=...` returning up to 8 lightweight
 * product hits for the search box dropdown. Free tier omits this endpoint
 * entirely — the storefront's search input falls back to a full page
 * navigation (`/?q=...`) which hits the existing `/api/products` LIKE query.
 *
 * Why a separate endpoint instead of paging `/api/products`:
 *  - The suggest payload is intentionally narrow (id, name, slug, priceUsd,
 *    image) so the dropdown stays snappy on slow networks.
 *  - It skips the stock join (a SELECT count per product key) since the
 *    dropdown only previews — the product detail page enforces real stock.
 *  - Future-proof: this is where we'll layer fuzzy matching / FTS if we
 *    outgrow LIKE.
 */
import type { Elysia } from "elysia";
import { and, asc, eq, like, or } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { products } from "../db/schema.ts";
import type { Plugin } from "../lib/plugin/types.ts";

const MAX_SUGGESTIONS = 8;

export const searchPlugin: Plugin = {
  manifest: {
    id: "search-suggest",
    version: "1.0.0",
    nexoraVersion: ">=0.2 <0.3",
    description: "Storefront search autocomplete (/api/products/suggest)",
  },
  register: (app: Elysia<any, any, any, any, any, any, any, any>) =>
    app.get("/api/products/suggest", async ({ query }) => {
      const q = (query as Record<string, string>)?.q?.trim() ?? "";
      // Empty/very short queries return nothing — avoids paging the whole
      // catalog on first keystroke. Frontend should not call below 1 char.
      if (q.length === 0) return { items: [] };

      const term = `%${q}%`;
      const rows = await db
        .select({
          id: products.id,
          name: products.name,
          slug: products.slug,
          priceUsd: products.priceUsd,
          image: products.image,
        })
        .from(products)
        .where(and(eq(products.active, true), or(like(products.name, term), like(products.description, term))!))
        .orderBy(asc(products.name))
        .limit(MAX_SUGGESTIONS);

      return { items: rows };
    }),
};
