import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import {
  adminActions,
  categories,
  coupons,
  orderItems,
  orders,
  productKeys,
  products,
  productVariants,
  reviews,
  sessions,
  users,
} from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import {
  hashPassword,
  revokeOtherSessions,
  SESSION_COOKIE,
  validateSession,
  verifyPassword,
} from "../lib/auth.ts";
import { EmailService } from "../lib/email.ts";
import { FEATURES, type FeatureKey, getFlags, setFlag } from "../lib/features.ts";
import { validateXpub } from "../lib/hd.ts";
import {
  adminProviderList,
  PROVIDER_BY_ID,
  setProviderEnabled,
  setProviderField,
} from "../lib/payments.ts";
import { rateLimitCheck } from "../lib/rate-limit.ts";
import { getAllSettings, setSetting } from "../lib/settings.ts";
import { SETTINGS_SCHEMA } from "../lib/settings-schema.ts";
import { uniqueSlug } from "../lib/slug.ts";

// Defense-in-depth rate limit on admin mutations. The admin is already
// authenticated, but if their cookie is ever stolen (XSS in a third-party
// admin tool, malware on the laptop, etc.) this caps the blast radius — an
// attacker can't run a 1000-product bulk-deactivate inside one minute. 60
// mutations/min is far above any human admin's pace and well below abuse.
const ADMIN_MUTATE_MAX = 60;
const ADMIN_MUTATE_WINDOW_MS = 60_000;

// In-process cache for /stats. Keyed by `days` so each range chip gets its
// own slot. TTL slightly under the admin overview's 30s poll so a single
// open tab keeps the cache hot while a hard refresh bypasses it.
const statsCache = new Map<number, { payload: any; expiresAt: number }>();

// Settings keys whose values must never leave the server in cleartext.
// `order_token_secret` is added so it never appears in the admin /settings GET
// even though the admin can otherwise see all key/value pairs — leaking it
// would let anyone forge guest order-view tokens.
const SECRET_KEYS = new Set([
  "resend_api_key",
  "smtp_pass",
  "smtp_user",
  "blockcypher_token",
  "order_token_secret",
  "discord_client_secret",
  "discord_bot_token",
  // maintenance_password is now hashed at write-time, but mask it in GET so
  // we don't leak the bcrypt hash either (a hash is itself attack-useful).
  "maintenance_password",
]);

// Allowlist for ?status= filters on admin orders / keys endpoints. Same set
// as the orders.status union; any other value falls through to "no filter"
// instead of being passed verbatim to drizzle.
const ORDER_STATUSES = new Set([
  "pending",
  "awaiting_payment",
  "underpaid",
  "paid",
  "completed",
  "expired",
  "cancelled",
]);
const KEY_STATUSES = new Set(["available", "reserved", "delivered"]);

// Image URL allowlist for admin-pasted URLs that end up in img src on the
// storefront. Pre-audit only PATCH /products/:id had this check inline;
// POST /products and POST/PATCH /categories silently accepted javascript:,
// data:, vbscript:, file:, etc. Returns true when safe; otherwise an error
// string the route handler surfaces verbatim.
function assertSafeImageUrl(value: unknown): true | string {
  if (typeof value !== "string") return "Image must be a string";
  const t = value.trim();
  if (t === "") return true;
  if (t.startsWith("//")) return "Protocol-relative URLs not allowed";
  if (t.startsWith("/")) return true;
  if (t.startsWith("https://")) return true;
  return "Image must be https:// or absolute /path";
}

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
    .select({
      productId: productKeys.productId,
      variantId: productKeys.variantId,
      status: productKeys.status,
      c: count(),
    })
    .from(productKeys)
    .where(
      and(inArray(productKeys.productId, productIds), sql`${productKeys.variantId} IS NOT NULL`),
    )
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
      const rl = rateLimitCheck(
        `admin-mutate:${user.id}`,
        ADMIN_MUTATE_MAX,
        ADMIN_MUTATE_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return {
          error: "Admin mutation rate limit hit",
          code: "RATE_LIMITED",
          retryAfterMs: rl.resetMs,
        };
      }
    }
    return;
  })
  // Expose the acting admin's email + id + raw cookie token to handlers.
  // - adminEmail / adminId fed the audit log and per-user rate limit keys.
  // - currentToken lets sensitive flows (password rotate, etc.) call
  //   revokeOtherSessions(adminId, currentToken) so the actor's own
  //   session survives the credential change while every other one drops.
  .derive(async ({ cookie }) => {
    const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
    const user = await validateSession(tok);
    return {
      adminEmail: user?.email ?? "unknown",
      adminId: user?.id ?? "",
      currentToken: tok,
    };
  })

  /* ───────── Activity log ───────── */
  .get("/activity", async () =>
    db.select().from(adminActions).orderBy(desc(adminActions.createdAt)).limit(200),
  )

  /* ───────── Products CRUD ───────── */
  .get("/products", async () => {
    const all = await db.select().from(products).orderBy(desc(products.createdAt));
    const productIds = all.map((p) => p.id);
    const counts = await keyCounts(productIds);
    const vCounts = await variantKeyCounts(productIds);

    const allVariants =
      productIds.length > 0
        ? await db
            .select()
            .from(productVariants)
            .where(inArray(productVariants.productId, productIds))
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
        available:
          pVariants.length > 0
            ? pVariants.reduce((sum, v) => sum + v.available, 0)
            : (counts[p.id]?.available ?? 0),
        delivered:
          pVariants.length > 0
            ? pVariants.reduce((sum, v) => sum + v.delivered, 0)
            : (counts[p.id]?.delivered ?? 0),
        variants: pVariants,
      };
    });
  })

  .post(
    "/products",
    async ({ body, set, adminEmail }) => {
      const imgErr = assertSafeImageUrl(body.image);
      if (imgErr !== true) {
        set.status = 400;
        return { error: imgErr, code: "BAD_IMAGE" };
      }
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
        deliverables: body.deliverables ?? ("serials" as const),
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
        deliverables: t.Optional(
          t.Union([t.Literal("serials"), t.Literal("service"), t.Literal("dynamic")]),
        ),
        variants: t.Optional(
          t.Array(
            t.Object({
              name: t.String({ minLength: 1 }),
              priceUsd: t.Number({ minimum: 0 }),
              compareAtPrice: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
            }),
          ),
        ),
      }),
    },
  )

  .patch(
    "/products/:id",
    async ({ params: { id }, body, set, adminEmail }) => {
      const existing = (await db.select().from(products).where(eq(products.id, id)))[0];
      if (!existing) {
        set.status = 404;
        return { error: "Product not found", code: "NOT_FOUND" };
      }
      if (body.image !== undefined) {
        const imgErr = assertSafeImageUrl(body.image);
        if (imgErr !== true) {
          set.status = 400;
          return { error: imgErr, code: "BAD_IMAGE" };
        }
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
      // Audit log: list field names only (not values — description can be
      // long/HTML, priceUsd reveals merchandising). Variant edits cascade
      // through `productVariants` below; surface that as a separate detail.
      const changedFields = Object.keys(updates);
      if (changedFields.length > 0 || body.variants !== undefined) {
        const detail =
          (changedFields.length > 0 ? changedFields.join(",") : "") +
          (body.variants !== undefined ? `${changedFields.length ? " + " : ""}variants` : "");
        await logAdminAction(adminEmail, "product.update", `${existing.name}: ${detail}`);
      }

      if (body.variants !== undefined) {
        const currentVariants = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.productId, id));
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
            await db
              .update(productVariants)
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
        deliverables: t.Optional(
          t.Union([t.Literal("serials"), t.Literal("service"), t.Literal("dynamic")]),
        ),
        variants: t.Optional(
          t.Array(
            t.Object({
              id: t.Optional(t.String()),
              name: t.String({ minLength: 1 }),
              priceUsd: t.Number({ minimum: 0 }),
              compareAtPrice: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
            }),
          ),
        ),
      }),
    },
  )

  // Soft-delete (deactivate) to preserve order history.
  .delete("/products/:id", async ({ params: { id }, set, adminEmail }) => {
    const existing = (await db.select().from(products).where(eq(products.id, id)))[0];
    if (!existing) {
      set.status = 404;
      return { error: "Product not found", code: "NOT_FOUND" };
    }
    await db.update(products).set({ active: false }).where(eq(products.id, id));
    await logAdminAction(adminEmail, "product.deactivate", existing.name);
    set.status = 200;
    return { ok: true, deactivated: id };
  })

  /* ───────── Key inventory ───────── */
  .post(
    "/products/:id/keys",
    async ({ params: { id }, body, set, adminEmail }) => {
      const product = (await db.select().from(products).where(eq(products.id, id)))[0];
      if (!product) {
        set.status = 404;
        return { error: "Product not found", code: "NOT_FOUND" };
      }
      if (body.variantId) {
        const variant = (
          await db
            .select()
            .from(productVariants)
            .where(and(eq(productVariants.id, body.variantId), eq(productVariants.productId, id)))
        )[0];
        if (!variant) {
          set.status = 400;
          return { error: "Variant not found for this product", code: "BAD_VARIANT" };
        }
      }
      // Normalize, drop blanks, de-dupe within the request.
      const incoming = Array.from(
        new Set(body.codes.map((c) => c.trim()).filter((c) => c.length > 0)),
      );
      // De-dupe against existing codes for this product & variant combination.
      const existing = await db
        .select({ code: productKeys.code })
        .from(productKeys)
        .where(
          and(
            eq(productKeys.productId, id),
            body.variantId
              ? eq(productKeys.variantId, body.variantId)
              : sql`${productKeys.variantId} IS NULL`,
          ),
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
            status: "available" as const,
          })),
        );
        // Inventory uploads must be audited: a compromised admin (or malicious
        // team member) could otherwise replace inventory with attacker-controlled
        // codes (Steam keys redeemed first, license codes that phone home) and
        // the operator would have no record of the swap.
        await logAdminAction(
          adminEmail,
          "keys.upload",
          `${product.name}: +${fresh.length} (${body.keyType ?? "code"})${
            body.variantId ? ` variant=${body.variantId.slice(0, 8)}` : ""
          }`,
        );
      }
      set.status = 201;
      return { added: fresh.length, duplicatesSkipped: incoming.length - fresh.length };
    },
    {
      body: t.Object({
        codes: t.Array(t.String({ maxLength: 1024 }), { minItems: 1, maxItems: 1000 }),
        variantId: t.Optional(t.Nullable(t.String())),
        keyType: t.Optional(
          t.Union([
            t.Literal("code"),
            t.Literal("account"),
            t.Literal("file"),
            t.Literal("instructions"),
          ]),
        ),
      }),
    },
  )

  .get("/products/:id/keys", async ({ params: { id }, query }) => {
    const status = (query as Record<string, string>).status;
    const where =
      status && KEY_STATUSES.has(status)
        ? and(eq(productKeys.productId, id), eq(productKeys.status, status as any))
        : eq(productKeys.productId, id);
    return db.select().from(productKeys).where(where).orderBy(desc(productKeys.createdAt));
  })

  .delete("/products/:id/keys/:keyId", async ({ params: { id, keyId }, set }) => {
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
  })

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
      out[k] = SECRET_KEYS.has(k) ? !!v : v;
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
    async ({ body, set, adminEmail }) => {
      // Schema-driven settings update: SETTINGS_SCHEMA declares every admin key.
      // Special case: ltc_xpub validates xpub + mirrors to pay_crypto_ltc_xpub +
      // sets hd_address_type. Everything else flows through the generic loop.
      const b = body as Record<string, any>;
      const changedKeys: string[] = [];

      if (b.ltc_xpub !== undefined && b.ltc_xpub !== "") {
        const v = validateXpub(b.ltc_xpub);
        if (!v.ok) {
          set.status = 400;
          return { error: `Invalid xpub: ${v.error}`, code: "BAD_XPUB" };
        }
        await setSetting("hd_address_type", v.type);
        await setSetting("pay_crypto_ltc_xpub", b.ltc_xpub);
        changedKeys.push("ltc_xpub");
      }

      // maintenance_password is a gate credential, not a display string —
      // hash it before persisting so a DB read (backup leak, future SQLi
      // somewhere else) doesn't surface a usable password. Hashing happens
      // BEFORE the generic loop so the loop's String() coercion can't store
      // the plaintext by accident. Empty string clears the gate. The 12-char
      // floor matches SETTINGS_SCHEMA — the maintenance gate is the only
      // thing protecting a half-deployed shop, so anything shorter is
      // bruteable in seconds against a keep-alive connection.
      if (b.maintenance_password !== undefined) {
        const raw = String(b.maintenance_password);
        if (raw === "") {
          await setSetting("maintenance_password", "");
        } else if (raw.length >= 12) {
          await setSetting("maintenance_password", await hashPassword(raw));
        } else {
          set.status = 400;
          return {
            error: "Maintenance password must be at least 12 characters",
            code: "BAD_PW",
          };
        }
        changedKeys.push("maintenance_password");
        delete b.maintenance_password; // skip the generic loop below
      }

      for (const def of SETTINGS_SCHEMA) {
        const value = b[def.key];
        if (value === undefined) continue;
        // Length cap defense (M6): typebox bounds the body shape but a
        // future schema relaxation must not let a multi-megabyte string
        // through to setSetting. Skip silently rather than 400, since
        // the typebox layer already rejects oversize payloads up front.
        if (
          def.maxLength !== undefined &&
          typeof value === "string" &&
          value.length > def.maxLength
        ) {
          continue;
        }
        // Defense-in-depth (M6): SETTINGS_SCHEMA declares per-key validators
        // (range checks for tax_rate/affiliate/etc.) that pre-audit lived
        // dead in the schema file because the loop ignored them. Wire them
        // up here so a 400 fires before setSetting persists nonsense.
        if (def.validate) {
          const v = def.validate(value);
          if (!v.ok) {
            set.status = 400;
            return { error: v.error || `Invalid value for ${def.key}`, code: "BAD_SETTING" };
          }
        }
        let toStore: string;
        if (def.type === "boolean") toStore = value ? "true" : "false";
        else if (def.type === "number") toStore = String(value);
        else toStore = String(value ?? "");
        await setSetting(def.key, toStore);
        changedKeys.push(def.key);
      }

      // Audit log: list keys touched, never values (would dump secrets like
      // resend_api_key, smtp_pass, custom_header_script payload).
      if (changedKeys.length > 0) {
        await logAdminAction(adminEmail, "settings.update", changedKeys.join(","));
      }

      const all = await getAllSettings();
      const xpub = all.ltc_xpub;
      const v = xpub ? validateXpub(xpub) : null;
      return {
        ok: true,
        xpub_set: !!xpub,
        xpub_type: v?.ok ? v.type : null,
        xpub_sample_address: v?.ok ? v.sample : null,
      };
    },
    {
      body: t.Object({
        ltc_xpub: t.Optional(t.String()),
        required_confirmations: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        payment_window_minutes: t.Optional(t.Integer({ minimum: 5, maximum: 120 })),
        store_name: t.Optional(t.String()),
        subdomain: t.Optional(t.String()),
        currency: t.Optional(t.String()),
        description: t.Optional(t.String()),
        discord: t.Optional(t.String()),
        youtube: t.Optional(t.String()),
        telegram: t.Optional(t.String()),
        tiktok: t.Optional(t.String()),
        instagram: t.Optional(t.String()),
        allow_change_theme: t.Optional(t.Boolean()),
        collect_billing: t.Optional(t.Boolean()),
        show_coupon: t.Optional(t.Boolean()),
        show_terms: t.Optional(t.Boolean()),
        precheck_terms: t.Optional(t.Boolean()),
        show_newsletter: t.Optional(t.Boolean()),
        enable_tax_calculation: t.Optional(t.Boolean()),
        tax_rate: t.Optional(t.Number()),
        send_invoice_pdfs: t.Optional(t.Boolean()),
        show_invoice_pdf_link: t.Optional(t.Boolean()),
        invoice_pdf_header: t.Optional(t.String()),
        invoice_pdf_notes: t.Optional(t.String()),
        invoice_pdf_footer: t.Optional(t.String()),
        enable_automatic_feedbacks: t.Optional(t.Boolean()),
        enable_affiliate_program: t.Optional(t.Boolean()),
        make_affiliate_program_public: t.Optional(t.Boolean()),
        allow_customers_edit_affiliate_code: t.Optional(t.Boolean()),
        affiliate_percentage: t.Optional(t.Number()),
        enable_tickets: t.Optional(t.Boolean()),
        terms_of_service: t.Optional(t.String()),
        privacy_policy: t.Optional(t.String()),
        refund_policy: t.Optional(t.String()),
        google_analytics: t.Optional(t.String()),
        crisp: t.Optional(t.String()),
        tawk_to: t.Optional(t.String()),
        trustpilot: t.Optional(t.String()),
        discord_client_id: t.Optional(t.String()),
        discord_client_secret: t.Optional(t.String()),
        discord_bot_token: t.Optional(t.String()),
        meta_title: t.Optional(t.String()),
        meta_description: t.Optional(t.String()),
        meta_twitter_card: t.Optional(t.String()),
        checkout_color_scheme: t.Optional(t.String()),
        redirect_custom_domain: t.Optional(t.Boolean()),
        hide_out_of_stock: t.Optional(t.Boolean()),
        refund_out_of_stock_to_balance: t.Optional(t.Boolean()),
        maintenance_password: t.Optional(t.String()),
        custom_domain_name: t.Optional(t.String()),
        maintenance_mode: t.Optional(t.Boolean()),
        custom_header_script: t.Optional(t.String()),
      }),
    },
  )

  /* ───────── Orders (admin view) ───────── */
  .get("/orders", async ({ query }) => {
    // Previously: unbounded `select * from orders` + per-row `select * from
    // orderItems where orderId = o.id`. At 50k orders that's 50k+1 queries
    // per page load and the admin UI auto-polls this every 8s. Now: paginate
    // to a default of 50 (max 200), then a single inArray() to fetch items
    // for the page in one round trip.
    const q = query as Record<string, string>;
    const status = q.status;
    const limitRaw = Number.parseInt(q.limit ?? "50", 10);
    const offsetRaw = Number.parseInt(q.offset ?? "0", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const baseWhere =
      status && ORDER_STATUSES.has(status) ? eq(orders.status, status as any) : undefined;

    const list = await (baseWhere
      ? db
          .select()
          .from(orders)
          .where(baseWhere)
          .orderBy(desc(orders.createdAt))
          .limit(limit)
          .offset(offset)
      : db
          .select()
          .from(orders)
          .orderBy(desc(orders.createdAt))
          .limit(limit)
          .offset(offset));

    if (list.length === 0) return [];

    // Single round trip for items across the entire page, then group by orderId.
    const ids = list.map((o) => o.id);
    const items = await db
      .select({ orderId: orderItems.orderId, name: orderItems.name, quantity: orderItems.quantity })
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids));
    const byOrder = new Map<string, { name: string; quantity: number }[]>();
    for (const it of items) {
      const arr = byOrder.get(it.orderId);
      if (arr) arr.push({ name: it.name, quantity: it.quantity });
      else byOrder.set(it.orderId, [{ name: it.name, quantity: it.quantity }]);
    }

    return list.map((o) => ({
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
      items: byOrder.get(o.id) ?? [],
    }));
  })

  // Detail view for a single order (admin).
  .get("/orders/:id", async ({ params: { id }, set }) => {
    const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
    if (!o) {
      set.status = 404;
      return { error: "Order not found", code: "NOT_FOUND" };
    }
    const items = await db
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        name: orderItems.name,
        quantity: orderItems.quantity,
        priceUsd: orderItems.priceUsd,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    // Keys assigned to this order (delivered serials).
    const keys = await db
      .select({
        id: productKeys.id,
        productId: productKeys.productId,
        code: productKeys.code,
        status: productKeys.status,
      })
      .from(productKeys)
      .where(eq(productKeys.orderId, id));
    return { ...o, items, keys };
  })

  // Resend email with keys to the customer (admin).
  .post("/orders/:id/resend-email", async ({ params: { id }, set, adminEmail }) => {
    // Two-tier rate limit:
    // 1. Per-order cooldown 1 / 5 min — prevents the simple "spam reload"
    //    accident or attack against a single order.
    // 2. Per-recipient daily cap 5 / 24h — prevents a compromised admin
    //    cookie from iterating over a customer's N orders (visible via
    //    /admin/customers/:id) and mail-bombing them. Spam reports tank
    //    deliverability for the whole shop, so this cap is critical even
    //    when only one admin is compromised.
    const rl = rateLimitCheck(`resend-email:${id}`, 1, 5 * 60_000);
    if (!rl.allowed) {
      set.status = 429;
      set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
      return {
        error: "Wait before resending again",
        code: "RATE_LIMITED",
        retryAfterMs: rl.resetMs,
      };
    }
    const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
    if (!o) {
      set.status = 404;
      return { error: "Order not found", code: "NOT_FOUND" };
    }
    if (o.status !== "paid" && o.status !== "completed") {
      set.status = 400;
      return { error: "Only paid or completed orders can have keys resent", code: "BAD_STATUS" };
    }

    // Per-recipient daily cap. Lowercase the email so case variations don't
    // create separate buckets. 5/day is enough headroom for legitimate
    // re-sends across multiple orders, ruinous for a mail-bomb.
    const recipientKey = `resend-email-recipient:${o.email.toLowerCase()}`;
    const recipientRl = rateLimitCheck(recipientKey, 5, 24 * 60 * 60_000);
    if (!recipientRl.allowed) {
      set.status = 429;
      set.headers["Retry-After"] = String(Math.ceil(recipientRl.resetMs / 1000));
      return {
        error: "Daily resend limit reached for this recipient",
        code: "RECIPIENT_RATE_LIMITED",
        retryAfterMs: recipientRl.resetMs,
      };
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

  /* ───────── Stats / revenue ─────── */
  .get("/stats", async ({ query }) => {
    const q = query as Record<string, string>;
    // Range is parsed/clamped — `?days=99999` capped at 90, `?days=foo` defaults to 14.
    const days = Math.max(1, Math.min(90, parseInt(q.days ?? "14", 10) || 14));

    // Cache hot reads for 25s — the admin overview polls every 30s, so a 25s
    // TTL means a single tab refresh keeps the cache hot while a hard refresh
    // (Cmd-R) bypasses it. Per-`days` so each range chip gets its own slot.
    const cached = statsCache.get(days);
    if (cached && cached.expiresAt > Date.now()) return cached.payload;

    // Push aggregation into SQL instead of streaming every order into JS:
    // - status histogram via GROUP BY status (uses orders_status_idx)
    // - paid+completed revenue via SUM with WHERE status IN
    // - day buckets via SUM/COUNT GROUP BY date(created_at) for the range
    // - recent 5 via ORDER BY createdAt DESC LIMIT 5 (uses orders_created_idx)
    // - total via COUNT(*)
    const dayMs = 86_400_000;
    const today = Math.floor(Date.now() / dayMs);
    const rangeStart = (today - (days - 1)) * dayMs;

    const [statusRows, totalRow, revenueRow, recentRows, seriesRows] = await Promise.all([
      db
        .select({ status: orders.status, n: count() })
        .from(orders)
        .groupBy(orders.status),
      db.select({ n: count() }).from(orders),
      db
        .select({
          totalUsd: sql<number>`COALESCE(SUM(${orders.totalUsd}), 0)`,
          totalLitoshi: sql<number>`COALESCE(SUM(${orders.expectedLitoshi}), 0)`,
        })
        .from(orders)
        .where(inArray(orders.status, ["paid", "completed"] as any)),
      db
        .select({
          id: orders.id,
          email: orders.email,
          status: orders.status,
          totalUsd: orders.totalUsd,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .orderBy(desc(orders.createdAt))
        .limit(5),
      // Bucket by UTC day. orders.createdAt is timestamp_ms so divide by
      // 86400000 then floor — equivalent to date() in UTC. WHERE bound on
      // rangeStart keeps the scan to N days even if the table has years.
      db
        .select({
          dayKey: sql<number>`CAST(${orders.createdAt} / ${dayMs} AS INTEGER)`,
          revenueUsd: sql<number>`COALESCE(SUM(${orders.totalUsd}), 0)`,
          n: count(),
        })
        .from(orders)
        .where(
          and(
            inArray(orders.status, ["paid", "completed"] as any),
            sql`${orders.createdAt} >= ${rangeStart}`,
          ),
        )
        .groupBy(sql`CAST(${orders.createdAt} / ${dayMs} AS INTEGER)`),
    ]);

    const byStatus: Record<string, number> = {
      pending: 0,
      awaiting_payment: 0,
      underpaid: 0,
      paid: 0,
      completed: 0,
      expired: 0,
      cancelled: 0,
    };
    for (const r of statusRows) {
      if (r.status) byStatus[r.status] = r.n;
    }
    const totalOrders = totalRow[0]?.n ?? 0;
    const revenueUsd = Number(revenueRow[0]?.totalUsd ?? 0);
    const revenueLtcLitoshi = Number(revenueRow[0]?.totalLitoshi ?? 0);

    // Build the day series; missing days from the SQL result stay at 0.
    const series: { day: string; revenueUsd: number; orders: number }[] = [];
    const seriesByKey = new Map(seriesRows.map((r) => [Number(r.dayKey), r]));
    for (let i = days - 1; i >= 0; i--) {
      const dayKey = today - i;
      const d = dayKey * dayMs;
      const row = seriesByKey.get(dayKey);
      series.push({
        day: new Date(d).toISOString().slice(0, 10),
        revenueUsd: row ? Number(row.revenueUsd) : 0,
        orders: row ? row.n : 0,
      });
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

    const payload = {
      totalOrders,
      ordersByStatus: byStatus,
      revenueUsd: Math.round(revenueUsd * 100) / 100,
      revenueLtc: (revenueLtcLitoshi / 1e8).toFixed(8),
      topProducts,
      lowStock,
      revenueSeries: series,
      recentOrders: recentRows.map((o) => ({
        id: o.id,
        email: o.email,
        status: o.status,
        totalUsd: o.totalUsd,
        createdAt: o.createdAt,
      })),
      rangeDays: days,
    };
    statsCache.set(days, { payload, expiresAt: Date.now() + 25_000 });
    return payload;
  })

  /* ───────── Email settings (optional) ───────── */
  .put(
    "/settings/email",
    async ({ body, adminEmail }) => {
      // Track which fields changed (especially secret-bearing ones) so the
      // audit log records the rotation without leaking the values themselves.
      // A compromised admin can swap the email API key/SMTP password to
      // exfiltrate every future delivery — without an audit entry the
      // operator has no record of the swap. Mirror the payment.config pattern.
      const changedFields: string[] = [];
      const secretFields: string[] = [];

      await setSetting("email_enabled", body.enabled ? "true" : "false");
      changedFields.push("enabled");
      if (body.provider !== undefined) {
        await setSetting("email_provider", body.provider);
        changedFields.push("provider");
      }
      if (body.from !== undefined) {
        await setSetting("email_from", body.from);
        changedFields.push("from");
      }
      if (body.resendApiKey) {
        await setSetting("resend_api_key", body.resendApiKey);
        changedFields.push("resendApiKey");
        secretFields.push("resendApiKey");
      }
      if (body.smtp) {
        await setSetting("smtp_host", body.smtp.host);
        await setSetting("smtp_port", String(body.smtp.port));
        await setSetting("smtp_secure", body.smtp.secure ? "true" : "false");
        await setSetting("smtp_user", body.smtp.user);
        changedFields.push("smtp.host", "smtp.port", "smtp.secure", "smtp.user");
        if (body.smtp.pass) {
          await setSetting("smtp_pass", body.smtp.pass);
          changedFields.push("smtp.pass");
          secretFields.push("smtp.pass");
        }
      }

      const detail =
        changedFields.join(", ") +
        (secretFields.length ? ` (secrets: ${secretFields.length})` : "");
      await logAdminAction(adminEmail, "settings.email.update", detail);

      return { ok: true, enabled: body.enabled, provider: body.provider ?? null };
    },
    {
      body: t.Object({
        enabled: t.Boolean(),
        provider: t.Optional(t.Union([t.Literal("resend"), t.Literal("smtp")])),
        from: t.Optional(t.String()),
        resendApiKey: t.Optional(t.String()),
        smtp: t.Optional(
          t.Object({
            host: t.String(),
            port: t.Integer(),
            secure: t.Boolean(),
            user: t.String(),
            pass: t.Optional(t.String()),
          }),
        ),
      }),
    },
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
      if (!(body.key in FEATURES)) {
        set.status = 400;
        return { error: "Unknown feature", code: "BAD_FEATURE" };
      }
      await setFlag(body.key as FeatureKey, body.enabled);
      return { ok: true, key: body.key, enabled: body.enabled };
    },
    { body: t.Object({ key: t.String(), enabled: t.Boolean() }) },
  )

  /* ───────── Plugins (per-id enable/disable; loader populates globalThis.__nexora_plugins) ───────── */
  .get("/plugins", async () => {
    const loaded = (globalThis as any).__nexora_plugins as
      | { id: string; version: string; description: string; loaded: boolean; reason?: string }[]
      | undefined;
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
    async ({ params, body, set, adminEmail }) => {
      const id = params.id;
      // Validate against the loaded-plugins registry. Without this guard, an
      // arbitrary `:id` (multi-megabyte garbage, prefix-collision attempts)
      // would pollute the settings table with `feature_plugin_*` keys —
      // storage bloat + cache poisoning vector for any future setting that
      // shares the prefix.
      const loaded = (globalThis as any).__nexora_plugins as
        | { id: string }[]
        | undefined;
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || !loaded?.some((p) => p.id === id)) {
        set.status = 400;
        return { error: "Unknown plugin", code: "BAD_PLUGIN" };
      }
      const value = (body as { enabled: boolean })?.enabled === true;
      await setSetting(`feature_plugin_${id}`, value ? "true" : "false");
      await logAdminAction(adminEmail, `plugin.${value ? "enable" : "disable"}`, id);
      return { ok: true, restart_required: true };
    },
    { body: t.Object({ enabled: t.Boolean() }) },
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
    { body: t.Object({ country: t.String() }) },
  )
  .put(
    "/payments/:id/enabled",
    async ({ params: { id }, body, set }) => {
      if (!PROVIDER_BY_ID[id]) {
        set.status = 400;
        return { error: "Unknown provider", code: "BAD_PROVIDER" };
      }
      await setProviderEnabled(id, body.enabled);
      return { ok: true, id, enabled: body.enabled };
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  )
  .put(
    "/payments/:id/config",
    async ({ params: { id }, body, set, adminEmail }) => {
      const def = PROVIDER_BY_ID[id];
      if (!def) {
        set.status = 400;
        return { error: "Unknown provider", code: "BAD_PROVIDER" };
      }
      // Only persist known fields; skip empty secret values so we don't wipe a saved secret.
      const changedNonSecret: string[] = [];
      let secretsChanged = 0;
      for (const f of def.fields) {
        const v = (body.config as Record<string, string>)[f.key];
        if (v === undefined) continue;
        if (f.secret && v === "") continue; // keep existing secret when left blank
        // crypto_ltc.xpub doubles as the checkout's `ltc_xpub` setting — validate the
        // shape (Ltub/Mtub/zpub/vpub) and mirror to the legacy key so checkout sees it.
        if (id === "crypto_ltc" && f.key === "xpub" && v.trim()) {
          const res = validateXpub(v.trim());
          if (!res.ok) {
            set.status = 400;
            return { error: `Invalid xpub: ${res.error}`, code: "BAD_XPUB" };
          }
          await setSetting("ltc_xpub", v.trim());
          await setSetting("hd_address_type", res.type);
        }
        await setProviderField(id, f.key, v);
        if (f.secret) secretsChanged++;
        else changedNonSecret.push(f.key);
      }
      // Audit a payment-config change. Critical for forensics: a compromised
      // admin swapping `xpub` to an attacker-owned wallet would otherwise
      // route every subsequent LTC payment to them with no log trail.
      // Never log the secret values themselves — only the field names.
      if (changedNonSecret.length > 0 || secretsChanged > 0) {
        await logAdminAction(
          adminEmail,
          "payment.config",
          `${id}: ${changedNonSecret.join(",") || "—"} (secrets:${secretsChanged})`,
        );
      }
      return { ok: true, id };
    },
    { body: t.Object({ config: t.Record(t.String(), t.String()) }) },
  )

  /* ───────── Customers ───────── */
  .get("/customers", async () => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        createdAt: users.createdAt,
        orderCount: sql<number>`count(${orders.id})`,
        totalSpentUsd: sql<number>`sum(case when ${orders.status} in ('paid','completed') then ${orders.totalUsd} else 0 end)`,
      })
      .from(users)
      .leftJoin(orders, eq(orders.userId, users.id))
      .where(eq(users.role, "customer"))
      .groupBy(users.id)
      .orderBy(desc(users.createdAt));

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      status: r.status,
      createdAt: r.createdAt,
      orderCount: Number(r.orderCount),
      totalSpentUsd: Math.round(Number(r.totalSpentUsd || 0) * 100) / 100,
    }));
  })
  .get("/customers/:id", async ({ params: { id }, set }) => {
    const u = (await db.select().from(users).where(eq(users.id, id)))[0];
    if (u?.role !== "customer") {
      set.status = 404;
      return { error: "Not found", code: "NOT_FOUND" };
    }
    const os = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, id))
      .orderBy(desc(orders.createdAt));
    return { id: u.id, email: u.email, status: u.status, createdAt: u.createdAt, orders: os };
  })
  .put(
    "/customers/:id/status",
    async ({ params: { id }, body, set, adminEmail }) => {
      const u = (await db.select().from(users).where(eq(users.id, id)))[0];
      if (u?.role !== "customer") {
        set.status = 404;
        return { error: "Not found", code: "NOT_FOUND" };
      }
      // Atomic ban: delete sessions FIRST, then flip status, both inside a
      // transaction. The previous order had a window where status=banned was
      // committed but sessions still resolved → an in-flight admin action
      // by the soon-to-be-banned user could still mutate state. SQLite
      // serializes writes so the tx closes that window completely.
      await db.transaction(async (tx) => {
        if (body.status === "banned") {
          await tx.delete(sessions).where(eq(sessions.userId, id));
        }
        await tx.update(users).set({ status: body.status }).where(eq(users.id, id));
      });
      await logAdminAction(
        adminEmail,
        body.status === "banned" ? "customer.ban" : "customer.unban",
        u.email,
      );
      return { ok: true, id, status: body.status };
    },
    { body: t.Object({ status: t.Union([t.Literal("active"), t.Literal("banned")]) }) },
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
      if (exists) {
        set.status = 409;
        return { error: "Code already exists", code: "DUP_CODE" };
      }
      const row = {
        id: randomUUID(),
        code,
        type: body.type,
        value: body.value,
        maxUses: body.maxUses ?? null,
        minOrderUsd: body.minOrderUsd ?? 0,
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
      await logAdminAction(
        adminEmail,
        "coupon.create",
        `${code} (${body.type === "percent" ? `${body.value}%` : `$${body.value}`})`,
      );
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
    },
  )
  .patch(
    "/coupons/:id",
    async ({ params: { id }, body, set, adminEmail }) => {
      const c = (await db.select().from(coupons).where(eq(coupons.id, id)))[0];
      if (!c) {
        set.status = 404;
        return { error: "Not found", code: "NOT_FOUND" };
      }
      // Re-validate against the existing coupon's TYPE. POST validates these
      // bounds; PATCH historically did not, so a compromised admin cookie
      // could PATCH `value=10000` on a percent coupon → 10000% discount →
      // checkout floor clamps total to $0.01 → effectively free goods. The
      // payment-loss path is identical to a missing POST validation.
      if (body.value !== undefined) {
        if (body.value < 0) {
          set.status = 400;
          return { error: "Coupon value must be ≥ 0", code: "BAD_VALUE" };
        }
        if (c.type === "percent" && body.value > 100) {
          set.status = 400;
          return { error: "Percent coupons must be 0..100", code: "BAD_VALUE" };
        }
        if (c.type === "fixed" && body.value > 10_000) {
          set.status = 400;
          return { error: "Fixed coupons capped at $10,000", code: "BAD_VALUE" };
        }
      }
      if (body.maxUses !== undefined && (body.maxUses < 1 || body.maxUses > 1_000_000)) {
        set.status = 400;
        return { error: "maxUses must be 1..1_000_000", code: "BAD_MAX_USES" };
      }
      if (
        body.minOrderUsd !== undefined &&
        (body.minOrderUsd < 0 || body.minOrderUsd > 1_000_000)
      ) {
        set.status = 400;
        return { error: "minOrderUsd must be 0..1_000_000", code: "BAD_MIN_ORDER" };
      }
      const u: Record<string, unknown> = {};
      if (body.active !== undefined) u.active = body.active;
      if (body.value !== undefined) u.value = body.value;
      if (body.maxUses !== undefined) u.maxUses = body.maxUses;
      if (body.minOrderUsd !== undefined) u.minOrderUsd = body.minOrderUsd;
      if (Object.keys(u).length === 0) return { ok: true };
      await db.update(coupons).set(u).where(eq(coupons.id, id));
      await logAdminAction(adminEmail, "coupon.update", `${c.code}: ${Object.keys(u).join(",")}`);
      return { ok: true };
    },
    {
      body: t.Object({
        active: t.Optional(t.Boolean()),
        value: t.Optional(t.Number()),
        maxUses: t.Optional(t.Integer()),
        minOrderUsd: t.Optional(t.Number()),
      }),
    },
  )
  .delete("/coupons/:id", async ({ params: { id }, adminEmail }) => {
    const c = (await db.select().from(coupons).where(eq(coupons.id, id)))[0];
    await db.delete(coupons).where(eq(coupons.id, id));
    if (c) await logAdminAction(adminEmail, "coupon.delete", c.code);
    return { ok: true };
  })

  /* ───────── Reviews moderation ───────── */
  .get("/reviews", async () => {
    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        body: reviews.body,
        email: reviews.email,
        hidden: reviews.hidden,
        createdAt: reviews.createdAt,
        productId: reviews.productId,
        productName: products.name,
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
      if (!r) {
        set.status = 404;
        return { error: "Not found", code: "NOT_FOUND" };
      }
      await db.update(reviews).set({ hidden: body.hidden }).where(eq(reviews.id, id));
      await logAdminAction(
        adminEmail,
        body.hidden ? "review.hide" : "review.unhide",
        `${r.rating}★ by ${r.email}`,
      );
      return { ok: true, hidden: body.hidden };
    },
    { body: t.Object({ hidden: t.Boolean() }) },
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
      if (body.image !== undefined) {
        const imgErr = assertSafeImageUrl(body.image);
        if (imgErr !== true) {
          set.status = 400;
          return { error: imgErr, code: "BAD_IMAGE" };
        }
      }
      // Slug uniqueness + parent depth check (max 4 levels deep).
      const slug = (body.slug?.trim() || body.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const dup = (
        await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug))
      )[0];
      if (dup) {
        set.status = 409;
        return { error: "Slug already in use", code: "DUP_SLUG" };
      }
      if (body.parentId) {
        // Walk parents to count depth — reject if would exceed 4.
        let depth = 1;
        let pid: string | null = body.parentId;
        while (pid && depth < 5) {
          const p: { parentId: string | null } | undefined = (
            await db
              .select({ parentId: categories.parentId })
              .from(categories)
              .where(eq(categories.id, pid))
          )[0];
          if (!p) {
            set.status = 400;
            return { error: "Parent not found", code: "BAD_PARENT" };
          }
          pid = p.parentId;
          depth++;
        }
        if (depth > 4) {
          set.status = 400;
          return { error: "Categories nest at most 4 levels deep", code: "TOO_DEEP" };
        }
      }
      const id = randomUUID();
      const row = {
        id,
        parentId: body.parentId ?? null,
        name: body.name,
        slug,
        description: body.description ?? "",
        image: body.image ?? "",
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
    },
  )
  .patch(
    "/categories/:id",
    async ({ params: { id }, body, set, adminEmail }) => {
      const cat = (await db.select().from(categories).where(eq(categories.id, id)))[0];
      if (!cat) {
        set.status = 404;
        return { error: "Not found", code: "NOT_FOUND" };
      }
      if (body.image !== undefined) {
        const imgErr = assertSafeImageUrl(body.image);
        if (imgErr !== true) {
          set.status = 400;
          return { error: imgErr, code: "BAD_IMAGE" };
        }
      }
      const upd: Record<string, unknown> = {};
      if (body.name !== undefined) upd.name = body.name;
      if (body.description !== undefined) upd.description = body.description;
      if (body.image !== undefined) upd.image = body.image;
      if (body.sortOrder !== undefined) upd.sortOrder = body.sortOrder;
      if (body.parentId !== undefined) {
        if (body.parentId === id) {
          set.status = 400;
          return { error: "Cannot parent to self", code: "SELF_PARENT" };
        }
        // Walk ancestors of the proposed parent — if THIS category appears in
        // that chain we'd create a cycle (A → B → A) → recursive tree builders
        // on the storefront would loop / blow the call stack. Also re-enforce
        // the 4-level depth cap that POST checks; reparenting can otherwise
        // push a deep subtree past the limit.
        if (body.parentId) {
          let depth = 1;
          let pid: string | null = body.parentId;
          const seen = new Set<string>();
          while (pid && depth < 16) {
            if (pid === id) {
              set.status = 400;
              return { error: "Reparenting would create a cycle", code: "CYCLE" };
            }
            if (seen.has(pid)) break; // pre-existing cycle in DB — bail safely
            seen.add(pid);
            const p: { parentId: string | null } | undefined = (
              await db
                .select({ parentId: categories.parentId })
                .from(categories)
                .where(eq(categories.id, pid))
            )[0];
            if (!p) {
              set.status = 400;
              return { error: "Parent not found", code: "BAD_PARENT" };
            }
            pid = p.parentId;
            depth++;
          }
          if (depth > 4) {
            set.status = 400;
            return { error: "Categories nest at most 4 levels deep", code: "TOO_DEEP" };
          }
        }
        upd.parentId = body.parentId;
      }
      if (body.slug !== undefined) {
        const slug = body.slug
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        const dup = (
          await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug))
        )[0];
        if (dup && dup.id !== id) {
          set.status = 409;
          return { error: "Slug already in use", code: "DUP_SLUG" };
        }
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
    },
  )
  .delete("/categories/:id", async ({ params: { id }, set, adminEmail }) => {
    const cat = (await db.select().from(categories).where(eq(categories.id, id)))[0];
    if (!cat) {
      set.status = 404;
      return { error: "Not found", code: "NOT_FOUND" };
    }
    // Refuse if it has children OR products attached — admin must reassign first.
    const children = (
      await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id))
    ).length;
    const used = (
      await db.select({ id: products.id }).from(products).where(eq(products.categoryId, id))
    ).length;
    if (children || used) {
      set.status = 400;
      return { error: `In use (${children} subcategories, ${used} products)`, code: "IN_USE" };
    }
    await db.delete(categories).where(eq(categories.id, id));
    await logAdminAction(adminEmail, "category.delete", cat.name);
    return { ok: true };
  })

  /* ───────── Account: rotate admin password ─────────
   * Self-service rotation that doesn't require ADMIN_BOOTSTRAP_FORCE on the
   * env. Verifies the current password against the stored argon2id hash,
   * persists the new hash, and revokes every OTHER session belonging to this
   * admin so a stolen cookie minted before the rotation cannot outlive the
   * change. The actor's current session survives so they aren't logged out
   * mid-flow. Audit-logged with the revoked-session count.
   *
   * Per-account rate limit (5/15min) deters credential-stuffing of the
   * current-password field by a stolen cookie that doesn't actually know
   * the password.
   */
  .post(
    "/account/password",
    async ({ body, set, adminId, adminEmail, currentToken }) => {
      const rl = rateLimitCheck(`admin-pw-rotate:${adminId}`, 5, 15 * 60_000);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      if (body.newPassword.length < 12) {
        set.status = 400;
        return {
          error: "New password must be at least 12 characters",
          code: "PW_TOO_SHORT",
        };
      }
      if (body.newPassword === body.currentPassword) {
        set.status = 400;
        return { error: "New password must differ from current", code: "PW_SAME" };
      }
      const u = (await db.select().from(users).where(eq(users.id, adminId)))[0];
      if (!u) {
        set.status = 404;
        return { error: "Admin not found", code: "NOT_FOUND" };
      }
      const ok = await verifyPassword(body.currentPassword, u.passwordHash);
      if (!ok) {
        set.status = 401;
        await logAdminAction(adminEmail, "account.password.fail", "current password mismatch");
        return { error: "Current password is incorrect", code: "BAD_CURRENT" };
      }
      const newHash = await hashPassword(body.newPassword);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, adminId));
      // Drop every other session — a stolen cookie minted before this point
      // must not survive the rotation. Keep the actor's so they aren't
      // immediately logged out.
      const revoked = await revokeOtherSessions(adminId, currentToken);
      await logAdminAction(
        adminEmail,
        "account.password.rotate",
        `Rotated password (revoked ${revoked} session${revoked === 1 ? "" : "s"})`,
      );
      return { ok: true, revokedSessions: revoked };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1, maxLength: 200 }),
        newPassword: t.String({ minLength: 12, maxLength: 200 }),
      }),
    },
  );
