import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { and, eq, count, inArray, desc, sql } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { products, productKeys, productVariants, orders, orderItems, users, sessions, coupons, reviews, adminActions, categories } from "../db/schema.ts";
import { validateSession, SESSION_COOKIE } from "../lib/auth.ts";
import { uniqueSlug } from "../lib/slug.ts";
import { getAllSettings, setSetting } from "../lib/settings.ts";
import { validateXpub } from "../lib/hd.ts";
import { getFlags, setFlag, FEATURES, type FeatureKey } from "../lib/features.ts";
import { adminProviderList, setProviderEnabled, setProviderField, PROVIDER_BY_ID } from "../lib/payments.ts";
import { logAdminAction } from "../lib/audit.ts";
import { EmailService } from "../lib/email.ts";
import { rateLimitCheck } from "../lib/rate-limit.ts";

// Defense-in-depth rate limit on admin mutations. The admin is already
// authenticated, but if their cookie is ever stolen (XSS in a third-party
// admin tool, malware on the laptop, etc.) this caps the blast radius — an
// attacker can't run a 1000-product bulk-deactivate inside one minute. 60
// mutations/min is far above any human admin's pace and well below abuse.
const ADMIN_MUTATE_MAX = 60;
const ADMIN_MUTATE_WINDOW_MS = 60_000;

// Settings keys whose values must never leave the server in cleartext.
// `order_token_secret` is added so it never appears in the admin /settings GET
// even though the admin can otherwise see all key/value pairs — leaking it
// would let anyone forge guest order-view tokens.
const SECRET_KEYS = new Set([
  "resend_api_key",
  "smtp_pass",
  "blockcypher_token",
  "order_token_secret",
]);

// Allowlist for ?status= filters on admin orders / keys endpoints. Same set
// as the orders.status union; any other value falls through to "no filter"
// instead of being passed verbatim to drizzle.
const ORDER_STATUSES = new Set([
  "pending", "awaiting_payment", "underpaid", "paid", "completed", "expired", "cancelled",
]);
const KEY_STATUSES = new Set(["available", "reserved", "delivered"]);
const CUSTOMER_STATUSES = new Set(["active", "banned"]);

/* key counts (available + delivered) per product */
async function keyCounts(productIds: string[]) {
  const m: Record<string, { available: number; delivered: number }> = {};
  if (productIds.length === 0) return m;
  const rows = await db
    .select({ productId: productKeys.productId, status: productKeys.status, c: count() })
    .from(productKeys)
    .where(inArray(productKeys.productId, productIds))
    .groupBy(productKeys.productId, productKeys.status);
  for (const r of rows) {
    const e = (m[r.productId] ??= { available: 0, delivered: 0 });
    if (r.status === "available") e.available = Number(r.c);
    if (r.status === "delivered") e.delivered = Number(r.c);
  }
  return m;
}

/* key counts per variant */
async function variantKeyCounts(productIds: string[]) {
  const m: Record<string, Record<string, { available: number; delivered: number }>> = {};
  if (productIds.length === 0) return m;
  const rows = await db
    .select({ productId: productKeys.productId, variantId: productKeys.variantId, status: productKeys.status, c: count() })
    .from(productKeys)
    .where(and(inArray(productKeys.productId, productIds), sql`${productKeys.variantId} IS NOT NULL`))
    .groupBy(productKeys.productId, productKeys.variantId, productKeys.status);
  for (const r of rows) {
    if (!r.variantId) continue;
    const prod = (m[r.productId] ??= {});
    const e = (prod[r.variantId] ??= { available: 0, delivered: 0 });
    if (r.status === "available") e.available = Number(r.c);
    if (r.status === "delivered") e.delivered = Number(r.c);
  }
  return m;
}

// Every /api/admin/* route requires an admin session. Instance-level guard applies to all.
export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .onBeforeHandle(async ({ cookie, status, request, set }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
    if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
    // Defense-in-depth: cap admin mutation rate per user id. GET reads remain
    // unthrottled — the dashboard polls them frequently. Stolen cookies
    // therefore can read everything (which the legitimate admin can also do)
    // but can't burst-write the catalog.
    const m = request.method;
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {
      const rl = rateLimitCheck(`admin-mutate:${user.id}`, ADMIN_MUTATE_MAX, ADMIN_MUTATE_WINDOW_MS);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Admin mutation rate limit hit", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
    }
    return;
  })
  // Expose the acting admin's email to handlers (for the audit log).
  .derive(async ({ cookie }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    return { adminEmail: user?.email ?? "unknown" };
  })

  /* ───────── Activity log ───────── */
  .get("/activity", async () => db.select().from(adminActions).orderBy(desc(adminActions.createdAt)).limit(200))

  /* ───────── Products CRUD ───────── */
  .get(
    "/products",
    async () => {
      const all = await db.select().from(products).orderBy(desc(products.createdAt));
      const productIds = all.map((p) => p.id);
      const counts = await keyCounts(productIds);
      const vCounts = await variantKeyCounts(productIds);

      const allVariants = productIds.length > 0
        ? await db.select().from(productVariants).where(inArray(productVariants.productId, productIds))
        : [];
      
      const variantsByProduct: Record<string, any[]> = {};
      for (const v of allVariants) {
        const vc = vCounts[v.productId]?.[v.id] ?? { available: 0, delivered: 0 };
        (variantsByProduct[v.productId] ??= []).push({
          ...v,
          available: vc.available,
          delivered: vc.delivered,
        });
      }

      return all.map((p) => {
        const pVariants = variantsByProduct[p.id] ?? [];
        return {
          ...p,
          available: pVariants.length > 0 ? pVariants.reduce((sum, v) => sum + v.available, 0) : (counts[p.id]?.available ?? 0),
          delivered: pVariants.length > 0 ? pVariants.reduce((sum, v) => sum + v.delivered, 0) : (counts[p.id]?.delivered ?? 0),
          variants: pVariants,
        };
      });
    }
  )

  .post(
    "/products",
    async ({ body, set, adminEmail }) => {
      const id = randomUUID();
      const slug = await uniqueSlug(body.slug || body.name);
      const row = {
        id,
        slug,
        name: body.name,
        description: body.description,
        priceUsd: body.priceUsd,
        compareAtPrice: body.compareAtPrice ?? null,
        image: body.image,
        category: body.category,
        categoryId: body.categoryId ?? null,
        active: body.active ?? true,
        deliverables: body.deliverables ?? "serials" as const,
      };
      await db.insert(products).values(row);

      const createdVariants: any[] = [];
      if (body.variants && body.variants.length > 0) {
        for (const v of body.variants) {
          const vRow = {
            id: randomUUID(),
            productId: id,
            name: v.name,
            priceUsd: v.priceUsd,
            compareAtPrice: v.compareAtPrice ?? null,
          };
          await db.insert(productVariants).values(vRow);
          createdVariants.push({ ...vRow, available: 0, delivered: 0 });
        }
      }

      await logAdminAction(adminEmail, "product.create", `${row.name} ($${row.priceUsd})`);
      set.status = 201;
      return { ...row, available: 0, delivered: 0, variants: createdVariants };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        priceUsd: t.Number({ minimum: 0 }),
        compareAtPrice: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        description: t.String({ default: "" }),
        image: t.String({ default: "" }),
        category: t.String({ minLength: 1 }),
        categoryId: t.Optional(t.Nullable(t.String())),
        slug: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
        deliverables: t.Optional(t.Union([t.Literal("serials"), t.Literal("service"), t.Literal("dynamic")])),
        variants: t.Optional(t.Array(t.Object({
          name: t.String({ minLength: 1 }),
          priceUsd: t.Number({ minimum: 0 }),
          compareAtPrice: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        }))),
      }),
    }
  )

  .patch(
    "/products/:id",
    async ({ params: { id }, body, set }) => {
      const existing = (await db.select().from(products).where(eq(products.id, id)))[0];
      if (!existing) {
        set.status = 404;
        return { error: "Product not found", code: "NOT_FOUND" };
      }
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.priceUsd !== undefined) updates.priceUsd = body.priceUsd;
      if (body.compareAtPrice !== undefined) updates.compareAtPrice = body.compareAtPrice;
      if (body.description !== undefined) updates.description = body.description;
      if (body.image !== undefined) updates.image = body.image;
      if (body.category !== undefined) updates.category = body.category;
      if (body.active !== undefined) updates.active = body.active;
      if (body.deliverables !== undefined) updates.deliverables = body.deliverables;
      if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
      if (body.slug !== undefined) updates.slug = await uniqueSlug(body.slug, id);
      await db.update(products).set(updates).where(eq(products.id, id));

      if (body.variants !== undefined) {
        const currentVariants = await db.select().from(productVariants).where(eq(productVariants.productId, id));
        const currentIds = currentVariants.map((v) => v.id);
        const incomingIds = body.variants.map((v) => v.id).filter(Boolean) as string[];

        // Delete removed variants
        const toDelete = currentIds.filter((cid) => !incomingIds.includes(cid));
        if (toDelete.length > 0) {
          await db.delete(productVariants).where(inArray(productVariants.id, toDelete));
        }

        // Add/Update incoming variants
        for (const v of body.variants) {
          if (v.id && currentIds.includes(v.id)) {
            await db.update(productVariants)
              .set({
                name: v.name,
                priceUsd: v.priceUsd,
                compareAtPrice: v.compareAtPrice ?? null,
              })
              .where(eq(productVariants.id, v.id));
          } else {
            await db.insert(productVariants).values({
              id: v.id || randomUUID(),
              productId: id,
              name: v.name,
              priceUsd: v.priceUsd,
              compareAtPrice: v.compareAtPrice ?? null,
            });
          }
        }
      }

      return { ...existing, ...updates };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        priceUsd: t.Optional(t.Number({ minimum: 0 })),
        compareAtPrice: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        description: t.Optional(t.String()),
        image: t.Optional(t.String()),
        category: t.Optional(t.String({ minLength: 1 })),
        categoryId: t.Optional(t.Nullable(t.String())),
        slug: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
        deliverables: t.Optional(t.Union([t.Literal("serials"), t.Literal("service"), t.Literal("dynamic")])),
        variants: t.Optional(t.Array(t.Object({
          id: t.Optional(t.String()),
          name: t.String({ minLength: 1 }),
          priceUsd: t.Number({ minimum: 0 }),
          compareAtPrice: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        }))),
      }),
    }
  )

  // Soft-delete (deactivate) to preserve order history.
  .delete(
    "/products/:id",
    async ({ params: { id }, set, adminEmail }) => {
      const existing = (await db.select().from(products).where(eq(products.id, id)))[0];
      if (!existing) {
        set.status = 404;
        return { error: "Product not found", code: "NOT_FOUND" };
      }
      await db.update(products).set({ active: false }).where(eq(products.id, id));
      await logAdminAction(adminEmail, "product.deactivate", existing.name);
      set.status = 200;
      return { ok: true, deactivated: id };
    }
  )

  /* ───────── Key inventory ───────── */
  .post(
    "/products/:id/keys",
    async ({ params: { id }, body, set }) => {
      const product = (await db.select().from(products).where(eq(products.id, id)))[0];
      if (!product) {
        set.status = 404;
        return { error: "Product not found", code: "NOT_FOUND" };
      }
      if (body.variantId) {
        const variant = (await db.select().from(productVariants).where(and(eq(productVariants.id, body.variantId), eq(productVariants.productId, id))))[0];
        if (!variant) {
          set.status = 400;
          return { error: "Variant not found for this product", code: "BAD_VARIANT" };
        }
      }
      // Normalize, drop blanks, de-dupe within the request.
      const incoming = Array.from(
        new Set(body.codes.map((c) => c.trim()).filter((c) => c.length > 0))
      );
      // De-dupe against existing codes for this product & variant combination.
      const existing = await db
        .select({ code: productKeys.code })
        .from(productKeys)
        .where(
          and(
            eq(productKeys.productId, id),
            body.variantId ? eq(productKeys.variantId, body.variantId) : sql`${productKeys.variantId} IS NULL`
          )
        );
      const existingSet = new Set(existing.map((e) => e.code));
      const fresh = incoming.filter((c) => !existingSet.has(c));
      if (fresh.length > 0) {
        await db.insert(productKeys).values(
          fresh.map((code) => ({
            id: randomUUID(),
            productId: id,
            variantId: body.variantId ?? null,
            code,
            keyType: body.keyType ?? "code",
            status: "available" as const
          }))
        );
      }
      set.status = 201;
      return { added: fresh.length, duplicatesSkipped: incoming.length - fresh.length };
    },
    {
      body: t.Object({
        codes: t.Array(t.String(), { minItems: 1 }),
        variantId: t.Optional(t.Nullable(t.String())),
        keyType: t.Optional(t.Union([t.Literal("code"), t.Literal("account"), t.Literal("file"), t.Literal("instructions")])),
      }),
    }
  )

  .get(
    "/products/:id/keys",
    async ({ params: { id }, query }) => {
      const status = (query as Record<string, string>).status;
      const where = status && KEY_STATUSES.has(status)
        ? and(eq(productKeys.productId, id), eq(productKeys.status, status as any))
        : eq(productKeys.productId, id);
      return db.select().from(productKeys).where(where).orderBy(desc(productKeys.createdAt));
    }
  )

  .delete(
    "/products/:id/keys/:keyId",
    async ({ params: { id, keyId }, set }) => {
      const key = (await db.select().from(productKeys).where(eq(productKeys.id, keyId)))[0];
      if (!key || key.productId !== id) {
        set.status = 404;
        return { error: "Key not found", code: "NOT_FOUND" };
      }
      if (key.status === "delivered") {
        set.status = 400;
        return { error: "Cannot delete a delivered key", code: "KEY_DELIVERED" };
      }
      await db.delete(productKeys).where(eq(productKeys.id, keyId));
      set.status = 200;
      return { ok: true };
    }
  )

  /* ───────── Settings (secrets masked) ───────── */
  .get("/settings", async () => {
    const all = await getAllSettings();
    const out: Record<string, string | boolean | null> = {};
    for (const [k, v] of Object.entries(all)) {
      // Secrets like resend_api_key / smtp_pass are surfaced as a boolean
      // "is set" flag so the admin UI can render a status indicator without
      // ever shipping the cleartext value to the browser.
      // order_token_secret is fully hidden (not even a boolean): leaking
      // its presence is fine but surfacing the value would be a forge key.
      if (k === "order_token_secret") continue;
      out[k] = SECRET_KEYS.has(k) ? (v ? true : false) : v;
    }
    // also surface the detected xpub type + sample address (no secret)
    const xpub = all.ltc_xpub;
    if (xpub) {
      const v = validateXpub(xpub);
      out.xpub_valid = v.ok;
      if (v.ok) {
        out.xpub_type = v.type;
        out.xpub_sample_address = v.sample;
      }
    }
    return out;
  })

  .put(
    "/settings",
    async ({ body, set }) => {
      // Validate xpub before persisting (reject unparseable keys).
      if (body.ltc_xpub !== undefined && body.ltc_xpub !== "") {
        const v = validateXpub(body.ltc_xpub);
        if (!v.ok) {
          set.status = 400;
          return { error: `Invalid xpub: ${v.error}`, code: "BAD_XPUB" };
        }
        await setSetting("ltc_xpub", body.ltc_xpub);
        await setSetting("hd_address_type", v.type);
        // Mirror to the Payments tab field so both screens stay in sync.
        await setSetting("pay_crypto_ltc_xpub", body.ltc_xpub);
      }
      if (body.required_confirmations !== undefined)
        await setSetting("required_confirmations", String(body.required_confirmations));
      if (body.payment_window_minutes !== undefined)
        await setSetting("payment_window_minutes", String(body.payment_window_minutes));
      if (body.store_name !== undefined) await setSetting("store_name", body.store_name);

      const all = await getAllSettings();
      const xpub = all.ltc_xpub;
      const v = xpub ? validateXpub(xpub) : null;
      return {
        ok: true,
        xpub_set: !!xpub,
        xpub_type: v && v.ok ? v.type : null,
        xpub_sample_address: v && v.ok ? v.sample : null,
      };
    },
    {
      body: t.Object({
        ltc_xpub: t.Optional(t.String()),
        required_confirmations: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        payment_window_minutes: t.Optional(t.Integer({ minimum: 5, maximum: 120 })),
        store_name: t.Optional(t.String()),
      }),
    }
  )

  /* ───────── Orders (admin view) ───────── */
  .get("/orders", async ({ query }) => {
    const status = (query as Record<string, string>).status;
    const list = status && ORDER_STATUSES.has(status)
      ? await db.select().from(orders).where(eq(orders.status, status as any)).orderBy(desc(orders.createdAt))
      : await db.select().from(orders).orderBy(desc(orders.createdAt));
    return Promise.all(
      list.map(async (o) => ({
        id: o.id,
        status: o.status,
        email: o.email,
        totalUsd: o.totalUsd,
        ltcAmount: o.ltcAmount,
        receivedLitoshi: o.receivedLitoshi,
        expectedLitoshi: o.expectedLitoshi,
        confirmations: o.confirmations,
        ltcAddress: o.ltcAddress,
        paidTxId: o.paidTxId,
        createdAt: o.createdAt,
        items: await db
          .select({ name: orderItems.name, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, o.id)),
      }))
    );
  })

  // Detail view for a single order (admin).
  .get("/orders/:id", async ({ params: { id }, set }) => {
    const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
    if (!o) { set.status = 404; return { error: "Order not found", code: "NOT_FOUND" }; }
    const items = await db
      .select({ id: orderItems.id, productId: orderItems.productId, name: orderItems.name, quantity: orderItems.quantity, priceUsd: orderItems.priceUsd })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    // Keys assigned to this order (delivered serials).
    const keys = await db
      .select({ id: productKeys.id, productId: productKeys.productId, code: productKeys.code, status: productKeys.status })
      .from(productKeys)
      .where(eq(productKeys.orderId, id));
    return { ...o, items, keys };
  })

  // Resend email with keys to the customer (admin).
  .post("/orders/:id/resend-email", async ({ params: { id }, set, adminEmail }) => {
    const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
    if (!o) { set.status = 404; return { error: "Order not found", code: "NOT_FOUND" }; }
    if (o.status !== "paid" && o.status !== "completed") {
      set.status = 400;
      return { error: "Only paid or completed orders can have keys resent", code: "BAD_STATUS" };
    }
    
    const keys = await db
      .select({ name: products.name, code: productKeys.code })
      .from(productKeys)
      .leftJoin(products, eq(productKeys.productId, products.id))
      .where(and(eq(productKeys.orderId, id), eq(productKeys.status, "delivered")));

    if (keys.length === 0) {
      set.status = 400;
      return { error: "No delivered keys found for this order", code: "NO_KEYS" };
    }

    const formattedKeys = keys.map((k) => ({
      name: k.name ?? "Digital Goods",
      code: k.code,
    }));

    const res = await EmailService.deliveredKeys(o.id, o.email, formattedKeys);
    if ("error" in res) {
      set.status = 500;
      return { error: `Failed to send email: ${res.error}`, code: "EMAIL_FAILED" };
    }
    
    await logAdminAction(adminEmail, "order.resend_email", `${o.id} to ${o.email}`);
    return { ok: true, message: "Email resent successfully" };
  })

  /* ───────── Stats / revenue ───────── */
  .get("/stats", async ({ query }) => {
    const q = query as Record<string, string>;
    // Range is parsed/clamped — `?days=99999` capped at 90, `?days=foo` defaults to 14.
    const days = Math.max(1, Math.min(90, parseInt(q.days ?? "14", 10) || 14));
    // For shops with millions of orders this is still a full scan; in that
    // regime move to a materialised daily-stats table. For everything else,
    // scanning under the admin guard is fine.
    const all = await db.select().from(orders);
    const byStatus: Record<string, number> = {
      pending: 0, awaiting_payment: 0, underpaid: 0, paid: 0, completed: 0, expired: 0, cancelled: 0,
    };
    let revenueUsd = 0;
    let revenueLtcLitoshi = 0;
    for (const o of all) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      if (o.status === "paid" || o.status === "completed") {
        revenueUsd += o.totalUsd;
        revenueLtcLitoshi += o.expectedLitoshi;
      }
    }

    const allProducts = await db.select().from(products);
    const counts = await keyCounts(allProducts.map((p) => p.id));
    const topProducts = [...allProducts]
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, sold: p.sold, priceUsd: p.priceUsd }));
    const lowStock = allProducts
      .map((p) => ({ id: p.id, name: p.name, available: counts[p.id]?.available ?? 0 }))
      .filter((p) => p.available <= 5)
      .sort((a, b) => a.available - b.available);

    // N-day revenue series (UTC day buckets) for the chart.
    const dayMs = 86_400_000;
    const today = Math.floor(Date.now() / dayMs);
    const series: { day: string; revenueUsd: number; orders: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = (today - i) * dayMs;
      series.push({ day: new Date(d).toISOString().slice(0, 10), revenueUsd: 0, orders: 0 });
    }
    const idx = (ts: number) => (days - 1) - (today - Math.floor(new Date(ts).getTime() / dayMs));
    for (const o of all) {
      if (o.status !== "paid" && o.status !== "completed") continue;
      const i = idx(new Date(o.createdAt).getTime());
      if (i >= 0 && i < days) { series[i].revenueUsd += o.totalUsd; series[i].orders += 1; }
    }

    // Most recent 5 orders (any status) for the "Latest orders" panel.
    const recentOrders = [...all]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map((o) => ({ id: o.id, email: o.email, status: o.status, totalUsd: o.totalUsd, createdAt: o.createdAt }));

    return {
      totalOrders: all.length,
      ordersByStatus: byStatus,
      revenueUsd: Math.round(revenueUsd * 100) / 100,
      revenueLtc: (revenueLtcLitoshi / 1e8).toFixed(8),
      topProducts,
      lowStock,
      revenueSeries: series,
      recentOrders,
      rangeDays: days,
    };
  })

  /* ───────── Email settings (optional) ───────── */
  .put(
    "/settings/email",
    async ({ body }) => {
      await setSetting("email_enabled", body.enabled ? "true" : "false");
      if (body.provider !== undefined) await setSetting("email_provider", body.provider);
      if (body.from !== undefined) await setSetting("email_from", body.from);
      if (body.resendApiKey) await setSetting("resend_api_key", body.resendApiKey);
      if (body.smtp) {
        await setSetting("smtp_host", body.smtp.host);
        await setSetting("smtp_port", String(body.smtp.port));
        await setSetting("smtp_secure", body.smtp.secure ? "true" : "false");
        await setSetting("smtp_user", body.smtp.user);
        if (body.smtp.pass) await setSetting("smtp_pass", body.smtp.pass);
      }
      return { ok: true, enabled: body.enabled, provider: body.provider ?? null };
    },
    {
      body: t.Object({
        enabled: t.Boolean(),
        provider: t.Optional(t.Union([t.Literal("resend"), t.Literal("smtp")])),
        from: t.Optional(t.String()),
        resendApiKey: t.Optional(t.String()),
        smtp: t.Optional(
          t.Object({ host: t.String(), port: t.Integer(), secure: t.Boolean(), user: t.String(), pass: t.Optional(t.String()) })
        ),
      }),
    }
  )

  /* ───────── Feature flags (clone-and-run toggles) ───────── */
  .get("/features", async () => {
    const flags = await getFlags();
    return Object.entries(FEATURES).map(([key, def]) => ({
      key,
      label: def.label,
      enabled: flags[key as FeatureKey],
    }));
  })
  .put(
    "/features",
    async ({ body, set }) => {
      if (!(body.key in FEATURES)) { set.status = 400; return { error: "Unknown feature", code: "BAD_FEATURE" }; }
      await setFlag(body.key as FeatureKey, body.enabled);
      return { ok: true, key: body.key, enabled: body.enabled };
    },
    { body: t.Object({ key: t.String(), enabled: t.Boolean() }) }
  )

  /* ───────── Plugins (per-id enable/disable; loader populates globalThis.__nexora_plugins) ───────── */
  .get("/plugins", async () => {
    const loaded = (globalThis as any).__nexora_plugins as { id: string; version: string; description: string; loaded: boolean; reason?: string }[] | undefined;
    if (!loaded) return { plugins: [] };
    const settings = await getAllSettings();
    return {
      plugins: loaded.map((p) => ({
        ...p,
        enabled: (settings[`feature_plugin_${p.id}`] ?? "true") === "true",
      })),
    };
  })
  .post(
    "/plugins/:id/enabled",
    async ({ params, body }) => {
      const id = params.id;
      const value = (body as { enabled: boolean })?.enabled === true;
      await setSetting(`feature_plugin_${id}`, value ? "true" : "false");
      return { ok: true, restart_required: true };
    },
    { body: t.Object({ enabled: t.Boolean() }) }
  )

  /* ───────── Payment providers (multi-gateway, per-country) ───────── */
  .get("/payments", async () => {
    const providers = await adminProviderList();
    const shopCountry = (await getAllSettings()).shop_country ?? "*";
    return { shopCountry, providers };
  })
  .put(
    "/payments/country",
    async ({ body }) => {
      await setSetting("shop_country", body.country);
      return { ok: true, shopCountry: body.country };
    },
    { body: t.Object({ country: t.String() }) }
  )
  .put(
    "/payments/:id/enabled",
    async ({ params: { id }, body, set }) => {
      if (!PROVIDER_BY_ID[id]) { set.status = 400; return { error: "Unknown provider", code: "BAD_PROVIDER" }; }
      await setProviderEnabled(id, body.enabled);
      return { ok: true, id, enabled: body.enabled };
    },
    { body: t.Object({ enabled: t.Boolean() }) }
  )
  .put(
    "/payments/:id/config",
    async ({ params: { id }, body, set }) => {
      const def = PROVIDER_BY_ID[id];
      if (!def) { set.status = 400; return { error: "Unknown provider", code: "BAD_PROVIDER" }; }
      // Only persist known fields; skip empty secret values so we don't wipe a saved secret.
      for (const f of def.fields) {
        const v = (body.config as Record<string, string>)[f.key];
        if (v === undefined) continue;
        if (f.secret && v === "") continue; // keep existing secret when left blank
        // crypto_ltc.xpub doubles as the checkout's `ltc_xpub` setting — validate the
        // shape (Ltub/Mtub/zpub/vpub) and mirror to the legacy key so checkout sees it.
        if (id === "crypto_ltc" && f.key === "xpub" && v.trim()) {
          const res = validateXpub(v.trim());
          if (!res.ok) { set.status = 400; return { error: `Invalid xpub: ${res.error}`, code: "BAD_XPUB" }; }
          await setSetting("ltc_xpub", v.trim());
          await setSetting("hd_address_type", res.type);
        }
        await setProviderField(id, f.key, v);
      }
      return { ok: true, id };
    },
    { body: t.Object({ config: t.Record(t.String(), t.String()) }) }
  )

  /* ───────── Customers ───────── */
  .get("/customers", async () => {
    const list = await db.select().from(users).where(eq(users.role, "customer")).orderBy(desc(users.createdAt));
    return Promise.all(
      list.map(async (u) => {
        const os = await db.select().from(orders).where(eq(orders.userId, u.id));
        const paid = os.filter((o) => o.status === "paid" || o.status === "completed");
        return {
          id: u.id, email: u.email, status: u.status, createdAt: u.createdAt,
          orderCount: os.length,
          totalSpentUsd: Math.round(paid.reduce((s, o) => s + o.totalUsd, 0) * 100) / 100,
        };
      })
    );
  })
  .get("/customers/:id", async ({ params: { id }, set }) => {
    const u = (await db.select().from(users).where(eq(users.id, id)))[0];
    if (!u || u.role !== "customer") { set.status = 404; return { error: "Not found", code: "NOT_FOUND" }; }
    const os = await db.select().from(orders).where(eq(orders.userId, id)).orderBy(desc(orders.createdAt));
    return { id: u.id, email: u.email, status: u.status, createdAt: u.createdAt, orders: os };
  })
  .put(
    "/customers/:id/status",
    async ({ params: { id }, body, set, adminEmail }) => {
      const u = (await db.select().from(users).where(eq(users.id, id)))[0];
      if (!u || u.role !== "customer") { set.status = 404; return { error: "Not found", code: "NOT_FOUND" }; }
      await db.update(users).set({ status: body.status }).where(eq(users.id, id));
      if (body.status === "banned") await db.delete(sessions).where(eq(sessions.userId, id)); // force logout
      await logAdminAction(adminEmail, body.status === "banned" ? "customer.ban" : "customer.unban", u.email);
      return { ok: true, id, status: body.status };
    },
    { body: t.Object({ status: t.Union([t.Literal("active"), t.Literal("banned")]) }) }
  )

  /* ───────── Coupons ───────── */
  .get("/coupons", async () => db.select().from(coupons).orderBy(desc(coupons.createdAt)))
  .post(
    "/coupons",
    async ({ body, set, adminEmail }) => {
      const code = body.code.trim().toUpperCase();
      // Tighten coupon code shape: must be alnum + dash/underscore, 1..40
      // chars. Without this, an admin (or a compromised admin session) could
      // store a multi-line / unicode code that breaks audit log formatting
      // or matches loosely if the comparison is ever changed.
      if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
        set.status = 400;
        return { error: "Coupon code must be 1-40 chars: A-Z, 0-9, _ or -", code: "BAD_CODE" };
      }
      // Percent coupons must be 0..100; fixed coupons must be reasonable.
      // Without this, percent=1000 would compute a 1000% discount and
      // produce a negative totalUsd before the Math.max(0.01, ...) clamp in
      // checkout.ts — which is also why we clamp here belt-and-braces.
      if (body.type === "percent" && (body.value < 0 || body.value > 100)) {
        set.status = 400;
        return { error: "Percent coupons must be 0..100", code: "BAD_VALUE" };
      }
      if (body.type === "fixed" && body.value > 10_000) {
        set.status = 400;
        return { error: "Fixed coupons capped at $10,000", code: "BAD_VALUE" };
      }
      const exists = (await db.select().from(coupons).where(eq(coupons.code, code)))[0];
      if (exists) { set.status = 409; return { error: "Code already exists", code: "DUP_CODE" }; }
      const row = {
        id: randomUUID(), code, type: body.type, value: body.value,
        maxUses: body.maxUses ?? null, minOrderUsd: body.minOrderUsd ?? 0,
        active: body.active ?? true,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      };
      try {
        await db.insert(coupons).values(row);
      } catch {
        // UNIQUE collision under a concurrent admin race — surface 409.
        set.status = 409;
        return { error: "Code already exists", code: "DUP_CODE" };
      }
      await logAdminAction(adminEmail, "coupon.create", `${code} (${body.type === "percent" ? body.value + "%" : "$" + body.value})`);
      set.status = 201;
      return row;
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 40 }),
        type: t.Union([t.Literal("percent"), t.Literal("fixed")]),
        value: t.Number({ minimum: 0 }),
        maxUses: t.Optional(t.Integer({ minimum: 1, maximum: 1_000_000 })),
        minOrderUsd: t.Optional(t.Number({ minimum: 0, maximum: 1_000_000 })),
        active: t.Optional(t.Boolean()),
        expiresAt: t.Optional(t.Number()),
      }),
    }
  )
  .patch(
    "/coupons/:id",
    async ({ params: { id }, body, set }) => {
      const c = (await db.select().from(coupons).where(eq(coupons.id, id)))[0];
      if (!c) { set.status = 404; return { error: "Not found", code: "NOT_FOUND" }; }
      const u: Record<string, unknown> = {};
      if (body.active !== undefined) u.active = body.active;
      if (body.value !== undefined) u.value = body.value;
      if (body.maxUses !== undefined) u.maxUses = body.maxUses;
      if (body.minOrderUsd !== undefined) u.minOrderUsd = body.minOrderUsd;
      await db.update(coupons).set(u).where(eq(coupons.id, id));
      return { ok: true };
    },
    { body: t.Object({ active: t.Optional(t.Boolean()), value: t.Optional(t.Number()), maxUses: t.Optional(t.Integer()), minOrderUsd: t.Optional(t.Number()) }) }
  )
  .delete("/coupons/:id", async ({ params: { id } }) => {
    await db.delete(coupons).where(eq(coupons.id, id));
    return { ok: true };
  })

  /* ───────── Reviews moderation ───────── */
  .get("/reviews", async () => {
    const rows = await db
      .select({
        id: reviews.id, rating: reviews.rating, body: reviews.body, email: reviews.email,
        hidden: reviews.hidden, createdAt: reviews.createdAt,
        productId: reviews.productId, productName: products.name,
      })
      .from(reviews)
      .leftJoin(products, eq(reviews.productId, products.id))
      .orderBy(desc(reviews.createdAt));
    return rows;
  })
  .put(
    "/reviews/:id/hidden",
    async ({ params: { id }, body, set, adminEmail }) => {
      const r = (await db.select().from(reviews).where(eq(reviews.id, id)))[0];
      if (!r) { set.status = 404; return { error: "Not found", code: "NOT_FOUND" }; }
      await db.update(reviews).set({ hidden: body.hidden }).where(eq(reviews.id, id));
      await logAdminAction(adminEmail, body.hidden ? "review.hide" : "review.unhide", `${r.rating}★ by ${r.email}`);
      return { ok: true, hidden: body.hidden };
    },
    { body: t.Object({ hidden: t.Boolean() }) }
  )
  .delete("/reviews/:id", async ({ params: { id }, adminEmail }) => {
    const r = (await db.select().from(reviews).where(eq(reviews.id, id)))[0];
    await db.delete(reviews).where(eq(reviews.id, id));
    if (r) await logAdminAction(adminEmail, "review.delete", `${r.rating}★ by ${r.email}`);
    return { ok: true };
  })

  /* ───────── Categories (tree, up to 4 levels) ───────── */
  // Flat list with product counts (for the table view). Admin uses the tree builder client-side.
  .get("/categories", async () => {
    const rows = await db.select().from(categories).orderBy(categories.sortOrder, categories.name);
    const counts = await db
      .select({ categoryId: products.categoryId, c: count() })
      .from(products)
      .groupBy(products.categoryId);
    const countMap: Record<string, number> = {};
    for (const r of counts) if (r.categoryId) countMap[r.categoryId] = Number(r.c);
    return rows.map((r) => ({ ...r, productCount: countMap[r.id] ?? 0 }));
  })
  .post(
    "/categories",
    async ({ body, set, adminEmail }) => {
      // Slug uniqueness + parent depth check (max 4 levels deep).
      const slug = (body.slug?.trim() || body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const dup = (await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)))[0];
      if (dup) { set.status = 409; return { error: "Slug already in use", code: "DUP_SLUG" }; }
      if (body.parentId) {
        // Walk parents to count depth — reject if would exceed 4.
        let depth = 1;
        let pid: string | null = body.parentId;
        while (pid && depth < 5) {
          const p: { parentId: string | null } | undefined = (await db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, pid)))[0];
          if (!p) { set.status = 400; return { error: "Parent not found", code: "BAD_PARENT" }; }
          pid = p.parentId; depth++;
        }
        if (depth > 4) { set.status = 400; return { error: "Categories nest at most 4 levels deep", code: "TOO_DEEP" }; }
      }
      const id = randomUUID();
      const row = {
        id, parentId: body.parentId ?? null, name: body.name, slug,
        description: body.description ?? "", image: body.image ?? "",
        sortOrder: body.sortOrder ?? 0,
      };
      await db.insert(categories).values(row);
      await logAdminAction(adminEmail, "category.create", row.name);
      set.status = 201;
      return row;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        slug: t.Optional(t.String()),
        parentId: t.Optional(t.Nullable(t.String())),
        description: t.Optional(t.String()),
        image: t.Optional(t.String()),
        sortOrder: t.Optional(t.Integer()),
      }),
    }
  )
  .patch(
    "/categories/:id",
    async ({ params: { id }, body, set, adminEmail }) => {
      const cat = (await db.select().from(categories).where(eq(categories.id, id)))[0];
      if (!cat) { set.status = 404; return { error: "Not found", code: "NOT_FOUND" }; }
      const upd: Record<string, unknown> = {};
      if (body.name !== undefined) upd.name = body.name;
      if (body.description !== undefined) upd.description = body.description;
      if (body.image !== undefined) upd.image = body.image;
      if (body.sortOrder !== undefined) upd.sortOrder = body.sortOrder;
      if (body.parentId !== undefined) {
        if (body.parentId === id) { set.status = 400; return { error: "Cannot parent to self", code: "SELF_PARENT" }; }
        upd.parentId = body.parentId;
      }
      if (body.slug !== undefined) {
        const slug = body.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const dup = (await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)))[0];
        if (dup && dup.id !== id) { set.status = 409; return { error: "Slug already in use", code: "DUP_SLUG" }; }
        upd.slug = slug;
      }
      await db.update(categories).set(upd).where(eq(categories.id, id));
      await logAdminAction(adminEmail, "category.update", cat.name);
      return { ok: true };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        slug: t.Optional(t.String()),
        parentId: t.Optional(t.Nullable(t.String())),
        description: t.Optional(t.String()),
        image: t.Optional(t.String()),
        sortOrder: t.Optional(t.Integer()),
      }),
    }
  )
  .delete("/categories/:id", async ({ params: { id }, set, adminEmail }) => {
    const cat = (await db.select().from(categories).where(eq(categories.id, id)))[0];
    if (!cat) { set.status = 404; return { error: "Not found", code: "NOT_FOUND" }; }
    // Refuse if it has children OR products attached — admin must reassign first.
    const children = (await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id))).length;
    const used = (await db.select({ id: products.id }).from(products).where(eq(products.categoryId, id))).length;
    if (children || used) { set.status = 400; return { error: `In use (${children} subcategories, ${used} products)`, code: "IN_USE" }; }
    await db.delete(categories).where(eq(categories.id, id));
    await logAdminAction(adminEmail, "category.delete", cat.name);
    return { ok: true };
  });
