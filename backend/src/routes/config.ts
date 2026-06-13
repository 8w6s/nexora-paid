import { eq, or } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db/connection.ts";
import { orders, reviews, users } from "../db/schema.ts";
import { getFlags } from "../lib/features.ts";
import { publicProviderList } from "../lib/payments.ts";
import { getSetting } from "../lib/settings.ts";

/**
 * Public storefront config routes — feature flags, branding, payment methods, stats.
 * No auth required; returns only booleans + safe display values (never secrets).
 */
export const configRoutes = new Elysia()
  /* ───── Public storefront config (feature flags + branding) ───── */
  // The frontend reads this to show/hide modules. Only booleans + safe display values; no secrets.
  .get("/api/config", async () => {
    const flags = await getFlags();
    const adminCount = (
      await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"))
    ).length;
    return {
      storeName: (await getSetting("store_name")) ?? "Nexora",
      needsSetup: adminCount === 0, // drives the /setup wizard
      faKitUrl: (await getSetting("fa_kit_url")) ?? Bun.env.FA_KIT_URL ?? null,
      features: flags,
    };
  })

  /* ───── Public: enabled payment methods (for the shop's country) ───── */
  .get("/api/payments", async ({ query }) => {
    const q = query as Record<string, string>;
    return { methods: await publicProviderList(q?.country) };
  })

  /* ───── Public storefront stats (sales / unique buyers / avg rating) ───── */
  .get("/api/storefront/stats", async () => {
    const paid = await db
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .where(or(eq(orders.status, "paid"), eq(orders.status, "completed"))!);
    const buyers = new Set(paid.map((o) => o.userId)).size;
    const rev = await db
      .select({ rating: reviews.rating })
      .from(reviews)
      .where(eq(reviews.hidden, false));
    const rating = rev.length
      ? Math.round((rev.reduce((s, r) => s + r.rating, 0) / rev.length) * 10) / 10
      : 0;
    return { sales: paid.length, buyers, rating };
  });
