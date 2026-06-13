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

import { and, asc, eq, like, or } from "drizzle-orm";
import type { Elysia } from "elysia";
import { db } from "../db/connection.ts";
import { products } from "../db/schema.ts";
import type { Plugin } from "../lib/plugin/types.ts";
import { rateLimitCheck, clientIp as resolveClientIp } from "../lib/rate-limit.ts";

const MAX_SUGGESTIONS = 8;
// 60 suggest queries / IP / minute. Each query is a `LIKE %q%` scan over
// products.name + description; an unthrottled keystroke loop can DoS the DB.
const SUGGEST_RATE_MAX = 60;
const SUGGEST_RATE_WINDOW_MS = 60_000;
// Hard cap on the search term: longer needles serve no UX purpose and the
// LIKE pattern itself becomes a memory hazard at scale.
const MAX_SUGGEST_LEN = 64;
// Refuse queries that are entirely SQL wildcards — `%`, `_` repeated would
// match the whole table on every row. Drizzle parameterises but the LIKE
// engine still walks the index.
const WILDCARD_ONLY = /^[%_\s]+$/;

export const searchPlugin: Plugin = {
  manifest: {
    id: "search-suggest",
    version: "1.0.0",
    nexoraVersion: ">=0.2 <0.3",
    description: "Storefront search autocomplete (/api/products/suggest)",
  },
  register: (app: Elysia<any, any, any, any, any, any, any, any>) =>
    app.get("/api/products/suggest", async ({ query, request, set }) => {
      const ip = resolveClientIp(request);
      const rl = rateLimitCheck(`suggest:${ip}`, SUGGEST_RATE_MAX, SUGGEST_RATE_WINDOW_MS);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return {
          error: "Too many search requests",
          code: "RATE_LIMITED",
          retryAfterMs: rl.resetMs,
        };
      }
      const raw = (query as Record<string, string>)?.q ?? "";
      const q = raw.slice(0, MAX_SUGGEST_LEN).trim();
      // Empty/very short queries return nothing — avoids paging the whole
      // catalog on first keystroke. Frontend should not call below 1 char.
      if (q.length === 0) return { items: [] };
      if (WILDCARD_ONLY.test(q)) return { items: [] };

      // Escape SQL LIKE meta-characters in user input so an attacker can't
      // turn the user-controlled `q` into a wildcard pattern that scans
      // everything (e.g. q="%" used to match every product).
      const BS = String.fromCharCode(92);
      const escaped = q.split(BS).join("").replace(/%/g, `${BS}%`).replace(/_/g, `${BS}_`);
      const term = `%${escaped}%`;
      const rows = await db
        .select({
          id: products.id,
          name: products.name,
          slug: products.slug,
          priceUsd: products.priceUsd,
          image: products.image,
        })
        .from(products)
        .where(
          and(
            eq(products.active, true),
            or(like(products.name, term), like(products.description, term))!,
          ),
        )
        .orderBy(asc(products.name))
        .limit(MAX_SUGGESTIONS);

      return { items: rows };
    }),
};
