import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { and, eq, count, inArray, like, or, asc, desc } from "drizzle-orm";
import { db } from "./db/connection.ts";
import { products, productKeys, users, orders, reviews, categories } from "./db/schema.ts";
import { getFlags } from "./lib/features.ts";
import { getSetting } from "./lib/settings.ts";
import { publicProviderList } from "./lib/payments.ts";
import { authRoutes, bootstrapAdmin } from "./routes/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { checkoutRoutes } from "./routes/checkout.ts";
import { setupRoutes } from "./routes/setup.ts";
import { reviewRoutes } from "./routes/reviews.ts";
import { ticketRoutes, adminTicketRoutes } from "./routes/tickets.ts";
import { startWatcher, recoverStuckOrders, onOrderDelivered } from "./lib/watcher.ts";
import { EmailService } from "./lib/email.ts";
import { loadPaidModules } from "./lib/paid-modules.ts";

const PUBLIC_ORIGIN = Bun.env.PUBLIC_ORIGIN ?? "http://localhost:4321";

/* available-key count per product → live stock */
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

// Free-tier app: every route in the Free baseline is chained here. Paid
// modules are loaded right before `.listen()` via `loadPaidModules()` so a
// Free build (with an empty registry) is byte-identical to "no Paid wiring".
const baseApp = new Elysia()
  // CORS for cookie auth: explicit origin + credentials (no wildcard).
  .use(cors({ origin: PUBLIC_ORIGIN, credentials: true }))
  // CSRF defense-in-depth: reject cross-origin state-changing requests.
  .onBeforeHandle(({ request, set }) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      const origin = request.headers.get("origin");
      if (origin && origin !== PUBLIC_ORIGIN) {
        set.status = 403;
        return { error: "Bad origin", code: "BAD_ORIGIN" };
      }
    }
    return;
  })

  .get("/api/health", () => ({ ok: true }))

  /* ───────── Public storefront config (feature flags + branding) ───────── */
  // The frontend reads this to show/hide modules. Only booleans + safe display values; no secrets.
  .get("/api/config", async () => {
    const flags = await getFlags();
    const adminCount = (await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"))).length;
    return {
      storeName: (await getSetting("store_name")) ?? "Nexora",
      needsSetup: adminCount === 0, // drives the /setup wizard
      faKitUrl: (await getSetting("fa_kit_url")) ?? Bun.env.FA_KIT_URL ?? null,
      features: flags,
    };
  })

  /* ───────── Public: enabled payment methods (for the shop's country) ───────── */
  .get("/api/payments", async ({ query }) => {
    const q = query as Record<string, string>;
    return { methods: await publicProviderList(q?.country) };
  })

  /* ───────── Public storefront stats (sales / unique buyers / avg rating) ───────── */
  .get("/api/storefront/stats", async () => {
    const paid = await db.select({ id: orders.id, userId: orders.userId }).from(orders).where(or(eq(orders.status, "paid"), eq(orders.status, "completed"))!);
    const buyers = new Set(paid.map((o) => o.userId)).size;
    const rev = await db.select({ rating: reviews.rating }).from(reviews).where(eq(reviews.hidden, false));
    const rating = rev.length ? Math.round((rev.reduce((s, r) => s + r.rating, 0) / rev.length) * 10) / 10 : 0;
    return { sales: paid.length, buyers, rating };
  })

  /* ───────── Public catalog: search + filter + sort (stock from product_keys) ───────── */
  .get("/api/products", async ({ query }) => {
    const q = (query as Record<string, string>);
    const conds = [eq(products.active, true)];
    if (q.category && q.category !== "All") conds.push(eq(products.category, q.category));
    if (q.q && q.q.trim()) {
      // SQLite LIKE is case-insensitive for ASCII; match name or description.
      const term = `%${q.q.trim()}%`;
      conds.push(or(like(products.name, term), like(products.description, term))!);
    }
    // Sort: newest (default), price-asc, price-desc, best-selling, name
    const order =
      q.sort === "price-asc" ? asc(products.priceUsd)
      : q.sort === "price-desc" ? desc(products.priceUsd)
      : q.sort === "best" ? desc(products.sold)
      : q.sort === "name" ? asc(products.name)
      : desc(products.createdAt);

    let rows = await db.select().from(products).where(and(...conds)).orderBy(order);
    const stock = await stockMap(rows.map((p) => p.id));
    let out = rows.map((p) => ({ ...p, stock: stock[p.id] ?? 0, inStock: (stock[p.id] ?? 0) > 0 }));
    if (q.inStock === "true") out = out.filter((p) => p.inStock); // in-stock-only filter
    return out;
  })

  // Public categories: read from the categories table (tree-aware) and fall back
  // to distinct legacy strings if the tree is empty. Counts use active products only.
  .get("/api/categories", async () => {
    const cats = await db.select().from(categories).orderBy(categories.sortOrder, categories.name);
    if (cats.length === 0) {
      const rows = await db
        .select({ category: products.category, c: count() })
        .from(products)
        .where(eq(products.active, true))
        .groupBy(products.category);
      return rows.map((r) => ({ id: null as string | null, name: r.category, slug: r.category, parentId: null as string | null, count: Number(r.c) }));
    }
    const counts = await db
      .select({ categoryId: products.categoryId, c: count() })
      .from(products)
      .where(eq(products.active, true))
      .groupBy(products.categoryId);
    const countMap: Record<string, number> = {};
    for (const r of counts) if (r.categoryId) countMap[r.categoryId] = Number(r.c);
    return cats.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, parentId: c.parentId,
      count: countMap[c.id] ?? 0,
    }));
  })

  .get("/api/products/:idOrSlug", async ({ params: { idOrSlug }, set }) => {
    let row = (await db.select().from(products).where(eq(products.slug, idOrSlug)))[0];
    if (!row) row = (await db.select().from(products).where(eq(products.id, idOrSlug)))[0];
    if (!row || !row.active) {
      set.status = 404;
      return { error: "Product not found", code: "NOT_FOUND" };
    }
    const stock = await stockMap([row.id]);
    return { ...row, stock: stock[row.id] ?? 0, inStock: (stock[row.id] ?? 0) > 0 };
  })

  .use(authRoutes)
  .use(adminRoutes)
  .use(adminTicketRoutes)
  .use(checkoutRoutes)
  .use(setupRoutes)
  .use(reviewRoutes)
  .use(ticketRoutes);

// Paid modules register here (gated by license). Empty registry = no-op.
const app = await loadPaidModules(baseApp);
app.listen(Number(Bun.env.PORT ?? 3000));

console.log(`Nexora API running at http://localhost:${Bun.env.PORT ?? 3000}`);
console.log(`CORS origin: ${PUBLIC_ORIGIN}`);

await bootstrapAdmin();

// Best-effort email on delivery (no-op unless email is configured in settings/env).
onOrderDelivered((orderId, email, keys) => {
  EmailService.deliveredKeys(orderId, email, keys).then((r) => {
    if ("error" in r) console.warn(`[email] order ${orderId} send failed: ${r.error}`);
    else if ("id" in r) console.log(`[email] delivered-keys sent for ${orderId} (${r.id})`);
  });
});

await recoverStuckOrders();
startWatcher();

export type App = typeof app;
