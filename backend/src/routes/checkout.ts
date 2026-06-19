import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import * as v from "valibot";
import { db } from "../db/connection.ts";
import {
  coupons,
  orderItems,
  orders,
  productKeys,
  products,
  productVariants,
  settings,
  users,
} from "../db/schema.ts";
import {
  generateOrderToken,
  hashPassword,
  SESSION_COOKIE,
  type SessionUser,
  validateSession,
  verifyOrderToken,
} from "../lib/auth.ts";
import { deriveReceiveAddress } from "../lib/hd.ts";
import { reserveKeys } from "../lib/inventory.ts";
import { hookBus } from "../lib/plugin/hook-bus.ts";
import { lockOrderRate } from "../lib/rate.ts";
import { rateLimitCheck, clientIp as resolveClientIp } from "../lib/rate-limit.ts";
import { getSetting, getSettingNumber, setSetting } from "../lib/settings.ts";

// Hard caps on checkout request shape — defense against memory blowup, qty
// overflow into coupon math, and per-IP request floods that drain HD address
// indexes / exchange-rate quota.
const MAX_LINE_QTY = 100; // per single cart line
const MAX_LINES_PER_ORDER = 30; // per cart
const CHECKOUT_RATE_MAX = 5; // 5 checkouts / IP / minute
const CHECKOUT_RATE_WINDOW_MS = 60_000;
const ORDER_STATUS_RATE_MAX = 60; // 60 polls / IP / minute (1/sec)
const ORDER_STATUS_WINDOW_MS = 60_000;

const CheckoutSchema = v.object({
  items: v.array(
    v.object({
      productId: v.string(),
      variantId: v.optional(v.nullable(v.string())),
      qty: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_LINE_QTY)),
    }),
    [v.minLength(1), v.maxLength(MAX_LINES_PER_ORDER)],
  ),
  method: v.optional(v.string()),
  coupon: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim().toUpperCase()),
    ),
  ),
  email: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim().toLowerCase()),
      v.email(),
      v.maxLength(254),
    ),
  ),
});

function ltcQrUrl(address: string, ltcAmount: string): string {
  // BIP21 litecoin URI rendered as a QR by a public image service (no key needed).
  const uri = `litecoin:${address}?amount=${ltcAmount}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(uri)}`;
}

export const checkoutRoutes = new Elysia()
  .macro({
    optionalUser: {
      async resolve({ cookie }) {
        const u = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
        return { user: u as SessionUser | undefined };
      },
    },
    user: {
      async resolve({ cookie, status }) {
        const u = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
        if (!u) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
        return { user: u as SessionUser };
      },
    },
  })
  /* ───────── Checkout (login optional; server-trusted prices) ───────── */
  .post(
    "/api/checkout",
    async ({ body: rawBody, user, status, set, request }) => {
      // Validation with Valibot
      const result = v.safeParse(CheckoutSchema, rawBody);
      if (!result.success) {
        return status(400, {
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: v.flatten(result.issues).nested,
        });
      }
      const body: any = result.output;

      // Per-IP throttle. Each successful checkout burns an HD address index
      // and a rate-lock against the upstream exchange — letting a single IP
      // spam this endpoint exhausts both. 5/min is generous for a real human.
      const ip = resolveClientIp(request);
      const rl = rateLimitCheck(`checkout:${ip}`, CHECKOUT_RATE_MAX, CHECKOUT_RATE_WINDOW_MS);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return {
          error: "Too many checkouts, slow down",
          code: "RATE_LIMITED",
          retryAfterMs: rl.resetMs,
        };
      }

      // Wallet must be configured.
      const xpub = await getSetting("ltc_xpub");
      if (!xpub) return status(503, { error: "Store wallet not configured", code: "NO_WALLET" });

      let checkoutEmail = "";
      let checkoutUserId = "";

      if (user) {
        checkoutEmail = user.email;
        checkoutUserId = user.id;
      } else {
        const emailNorm = body.email;
        if (!emailNorm) {
          return status(400, {
            error: "Email is required for guest checkout",
            code: "EMAIL_REQUIRED",
          });
        }
        const existing = (await db.select().from(users).where(eq(users.email, emailNorm)))[0];
        if (existing) {
          checkoutEmail = existing.email;
          checkoutUserId = existing.id;
        } else {
          // Race-safe guest insert. The pre-select above is best-effort;
          // two concurrent guest checkouts with the same email would both
          // observe "no existing user" and both try to INSERT. The users
          // table has a UNIQUE index on email, so the loser's INSERT throws.
          // We catch the conflict, re-read the now-existing row, and proceed
          // with that user id — gracefully reusing instead of returning 500.
          const newId = randomUUID();
          const randPw = `${randomUUID()}-guest-${Date.now()}`;
          const pwHash = await hashPassword(randPw);
          try {
            await db
              .insert(users)
              .values({ id: newId, email: emailNorm, passwordHash: pwHash, role: "customer" });
            checkoutEmail = emailNorm;
            checkoutUserId = newId;
          } catch (e) {
            // SQLite UNIQUE violation surfaces as "UNIQUE constraint failed:
            // users.email" in the error message. Re-read by the constraint's
            // key — if the row now exists, the race winner committed and
            // it's safe to reuse. Otherwise the failure was something else,
            // rethrow so the surrounding handler maps it to a 500.
            const winner = (await db.select().from(users).where(eq(users.email, emailNorm)))[0];
            if (!winner) throw e;
            checkoutEmail = winner.email;
            checkoutUserId = winner.id;
          }
        }
      }

      // Re-fetch every product from DB (never trust client prices), check active + stock.
      let totalUsd = 0;
      const lines: {
        product: typeof products.$inferSelect;
        variant?: typeof productVariants.$inferSelect;
        qty: number;
      }[] = [];
      for (const item of body.items) {
        const p = (await db.select().from(products).where(eq(products.id, item.productId)))[0];
        if (!p?.active)
          return status(400, {
            error: `Product ${item.productId} unavailable`,
            code: "BAD_PRODUCT",
          });

        let price = p.priceUsd;
        let vRow;

        if (item.variantId) {
          vRow = (
            await db
              .select()
              .from(productVariants)
              .where(
                and(eq(productVariants.id, item.variantId), eq(productVariants.productId, p.id)),
              )
          )[0];
          if (!vRow)
            return status(400, {
              error: `Variant ${item.variantId} unavailable`,
              code: "BAD_VARIANT",
            });
          price = vRow.priceUsd;
        }

        const avail = await db
          .select({ c: sql<number>`count(*)` })
          .from(productKeys)
          .where(
            and(
              eq(productKeys.productId, p.id),
              item.variantId
                ? eq(productKeys.variantId, item.variantId)
                : sql`${productKeys.variantId} IS NULL`,
              eq(productKeys.status, "available"),
            ),
          );
        if (Number(avail[0]?.c ?? 0) < item.qty)
          return status(400, {
            error: `${p.name}${vRow ? ` (${vRow.name})` : ""} is out of stock`,
            code: "OUT_OF_STOCK",
          });
        totalUsd += price * item.qty;
        lines.push({ product: p, variant: vRow, qty: item.qty });
      }
      totalUsd = Math.round(totalUsd * 100) / 100;

      // Apply coupon (discount on USD total, before coin conversion). Validated server-side.
      // NOTE: this is the PRE-CHECK so we can compute totalUsd for the rate lock; the
      // usedCount field is re-read + incremented INSIDE the order transaction below so
      // two concurrent checkouts racing on a single-use coupon can't both consume it.
      let appliedCoupon: typeof coupons.$inferSelect | null = null;
      if (body.coupon) {
        const c = (await db.select().from(coupons).where(eq(coupons.code, body.coupon)))[0];
        const now = Date.now();
        const valid =
          c?.active &&
          (c.maxUses == null || c.usedCount < c.maxUses) &&
          (c.expiresAt == null || new Date(c.expiresAt).getTime() > now) &&
          totalUsd >= c.minOrderUsd;
        if (!valid)
          return status(400, { error: "Invalid or ineligible coupon", code: "BAD_COUPON" });
        // Cap coupon math: percent must be 0..100 and dollar discount cannot
        // exceed totalUsd. Without these clamps a bad row in `coupons` (or a
        // future admin-side mistake) could produce a negative subtotal that
        // gets floored to $0.01 — effectively free goods. The original code
        // floored to 0.01 but did not validate the inputs that made the
        // flor necessary.
        let discount: number;
        if (c?.type === "percent") {
          const pct = Math.max(0, Math.min(100, c?.value ?? 0));
          discount = (totalUsd * pct) / 100;
        } else {
          discount = Math.max(0, Math.min(totalUsd, c?.value ?? 0));
        }
        totalUsd = Math.max(0.01, Math.round((totalUsd - discount) * 100) / 100);
        appliedCoupon = c!;
      }

      const windowMin = await getSettingNumber("payment_window_minutes", 15);
      let lock;
      try {
        lock = await lockOrderRate(totalUsd, windowMin);
      } catch {
        return status(503, { error: "Exchange rate unavailable, try again", code: "NO_RATE" });
      }

      // Order ID: 16-char hex (64 bits) keeps the namespace large enough that
      // an attacker who knows the base prefix `GG-` still has 2^64 to brute
      // force per probe. The previous 8-char form was 32 bits — feasible to
      // enumerate against /api/orders/:id/status (which now rate-limits, but
      // 60/min/IP × distributed = thousands/sec) to find paid orders by
      // delivery side-channel. UUIDv4 split was also Unicode-uppercase which
      // is fine for hex but unnecessarily lossy.
      const orderId = `GG-${randomBytes(8).toString("hex").toUpperCase()}`;

      // Allocate a unique HD index + address, reserve keys, insert order — all in
      try {
        const result = await db.transaction(async (tx) => {
          // HD index MUST be monotonic — never derive from `max(orders.addressIndex)`
          // because an admin DELETE on a stuck pending order would shrink the
          // max and the next checkout would reuse that index → address reuse,
          // which leaks the buyer's privacy by linking unrelated orders to one
          // on-chain address. Read+bump `hd_next_index` inside the tx so SQLite's
          // write serialization gives us a unique increasing value; UNIQUE on
          // ltc_address + addressIndex remains the hard backstop.
          const counter = await getSettingNumber("hd_next_index", 0);
          // Backfill: if existing orders went past `counter` (older builds),
          // jump forward — we never go backward.
          const maxRow = await tx
            .select({ m: sql<number>`coalesce(max(${orders.addressIndex}), -1)` })
            .from(orders);
          const addressIndex = Math.max(counter, Number(maxRow[0]?.m ?? -1) + 1);
          const ltcAddress = deriveReceiveAddress(xpub, addressIndex);

          // Insert order BEFORE reserveKeys: product_keys.order_id has a FK
          // reference to orders.id, so updating it to a not-yet-existing order
          // row throws SQLITE_CONSTRAINT_FOREIGNKEY. Items are inserted in the
          // same order — they share the same FK constraint.
          await tx.insert(orders).values({
            id: orderId,
            userId: checkoutUserId,
            email: checkoutEmail,
            status: "pending",
            totalUsd,
            ltcRate: lock.ltcRate,
            rateSource: lock.rateSource,
            ltcAmount: lock.ltcAmount,
            expectedLitoshi: lock.expectedLitoshi,
            addressIndex,
            ltcAddress,
            expiresAt: new Date(lock.expiresAt),
          });
          for (const { product, variant, qty } of lines) {
            await tx.insert(orderItems).values({
              id: randomUUID(),
              orderId,
              productId: product.id,
              name: product.name + (variant ? ` (${variant.name})` : ""),
              priceUsd: variant ? variant.priceUsd : product.priceUsd,
              quantity: qty,
            });
          }
          for (const { product, variant, qty } of lines) {
            const okk = await reserveKeys(tx as any, product.id, orderId, qty, variant?.id);
            if (!okk)
              throw new Error(`OUT_OF_STOCK:${product.name}${variant ? ` (${variant.name})` : ""}`);
          }

          // Atomic coupon consumption: re-read the row inside this transaction
          // (SQLite serializes write txs, so this picks up another checkout's
          // increment if it landed first) and only commit the use if there's
          // still capacity. Throw a sentinel so the surrounding catch maps it
          // to a 400, identical to the pre-check rejection path.
          if (appliedCoupon) {
            const fresh = (
              await tx.select().from(coupons).where(eq(coupons.id, appliedCoupon.id))
            )[0];
            const stillValid =
              fresh?.active && (fresh.maxUses == null || fresh.usedCount < fresh.maxUses);
            if (!stillValid) throw new Error("COUPON_EXHAUSTED");
            await tx
              .update(coupons)
              .set({ usedCount: fresh.usedCount + 1 })
              .where(eq(coupons.id, fresh.id));
          }

          // Advance the monotonic counter INSIDE the transaction so a crash
          // between the order INSERT and the setting write can't roll back the
          // address allocation while leaving the counter behind. Previously
          // this ran post-tx; under heavy concurrency two checkouts could
          // observe the same `counter`, both succeed via the `max+1` fallback,
          // and the counter would lag behind reality.
          await tx
            .insert(settings)
            .values({ key: "hd_next_index", value: String(addressIndex + 1) })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value: String(addressIndex + 1) },
            });

          return { addressIndex, ltcAddress };
        });

        // Emit hook for plugins to react (discord notification, analytics, etc.)
        hookBus.emit("order.created", { orderId, userId: checkoutUserId }).catch(() => {});

        set.status = 201;
        return {
          orderId,
          status: "pending",
          totalUsd,
          usdLtcRate: lock.ltcRate,
          ltcAmount: lock.ltcAmount,
          expectedLitoshi: lock.expectedLitoshi,
          ltcAddress: result.ltcAddress,
          qrCodeUrl: ltcQrUrl(result.ltcAddress, lock.ltcAmount),
          rateExpiresAt: lock.expiresAt,
          orderToken: generateOrderToken(orderId),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("OUT_OF_STOCK"))
          return status(400, {
            error: `${msg.split(":")[1] ?? "Item"} is out of stock`,
            code: "OUT_OF_STOCK",
          });
        if (msg === "COUPON_EXHAUSTED")
          return status(400, {
            error: "Coupon just ran out — try again without it",
            code: "COUPON_EXHAUSTED",
          });
        console.error("[checkout] failed:", e);
        return status(500, { error: "Checkout failed", code: "CHECKOUT_FAILED" });
      }
    },
    {
      optionalUser: true,
    },
  )

  /* ───────── Customer orders (IDOR-safe) ───────── */
  .get(
    "/api/orders",
    async ({ user }) => {
      const list = await db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.id))
        .orderBy(desc(orders.createdAt));
      return Promise.all(
        list.map(async (o) => ({
          id: o.id,
          status: o.status,
          totalUsd: o.totalUsd,
          ltcAmount: o.ltcAmount,
          createdAt: o.createdAt,
          items: await db
            .select({
              name: orderItems.name,
              quantity: orderItems.quantity,
              priceUsd: orderItems.priceUsd,
            })
            .from(orderItems)
            .where(eq(orderItems.orderId, o.id)),
        })),
      );
    },
    { user: true },
  )

  .get(
    "/api/orders/:id",
    async ({ params: { id }, query, user, status }) => {
      const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
      // Tighten the IDOR check: the original code did `user && (o.userId ===
      // user.id || ...)`. Since `o` may be undefined, `o.userId` would throw
      // — but the (!o ...) check below caught that, so it was just an
      // unhandled exception path. Reorder to short-circuit when the order
      // doesn't exist before touching o.userId.
      const isOwner = !!o && !!user && (o.userId === user.id || user.role === "admin");
      const isTokenValid = verifyOrderToken(id, query?.token);
      if (!o || (!isOwner && !isTokenValid))
        return status(404, { error: "Not found", code: "NOT_FOUND" });

      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
      const delivered =
        o.status === "paid" || o.status === "completed"
          ? await db
              .select({ code: productKeys.code, productId: productKeys.productId })
              .from(productKeys)
              .where(and(eq(productKeys.orderId, id), eq(productKeys.status, "delivered")))
          : [];
      return {
        id: o.id,
        status: o.status,
        totalUsd: o.totalUsd,
        ltcAmount: o.ltcAmount,
        expectedLitoshi: o.expectedLitoshi,
        ltcAddress: o.ltcAddress,
        qrCodeUrl: ltcQrUrl(o.ltcAddress, o.ltcAmount),
        confirmations: o.confirmations,
        rateExpiresAt: o.expiresAt,
        items,
        deliveredKeys: delivered,
      };
    },
    {
      optionalUser: true,
      query: t.Object({
        token: t.Optional(t.String()),
      }),
    },
  )

  // Lightweight polling endpoint for the pay page (DB only; watcher updates it).
  .get(
    "/api/orders/:id/status",
    async ({ params: { id }, query, user, status, request, set }) => {
      // 60 polls/IP/min — pay page polls every few seconds; anything faster
      // is automation. Bucketing by IP+orderId would be tighter but a single
      // bucket per IP is enough to stop a stampede.
      const ip = resolveClientIp(request);
      const rl = rateLimitCheck(
        `order-status:${ip}`,
        ORDER_STATUS_RATE_MAX,
        ORDER_STATUS_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Polling too fast", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
      const isOwner = user && o && (o.userId === user.id || user.role === "admin");
      const isTokenValid = verifyOrderToken(id, query?.token);
      if (!o || (!isOwner && !isTokenValid))
        return status(404, { error: "Not found", code: "NOT_FOUND" });

      const requiredConf = await getSettingNumber("required_confirmations", 2);
      return {
        status: o.status,
        confirmations: o.confirmations,
        requiredConfirmations: requiredConf,
        receivedLitoshi: o.receivedLitoshi,
        expectedLitoshi: o.expectedLitoshi,
        expiresInSec: Math.max(
          0,
          Math.floor((new Date(o.expiresAt).getTime() - Date.now()) / 1000),
        ),
      };
    },
    {
      optionalUser: true,
      query: t.Object({
        token: t.Optional(t.String()),
      }),
    },
  );
