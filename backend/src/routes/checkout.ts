import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import {
  coupons,
  orderItems,
  orders,
  productKeys,
  products,
  productVariants,
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
    async ({ body, user, status, set, request }) => {
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

      if (body.items.length === 0)
        return status(400, { error: "Cart is empty", code: "EMPTY_CART" });
      if (body.items.length > MAX_LINES_PER_ORDER)
        return status(400, {
          error: `Max ${MAX_LINES_PER_ORDER} line items per order`,
          code: "TOO_MANY_LINES",
        });
      // Sanitize qty: Elysia validates min=1 already, but it has no max — a
      // qty of Number.MAX_SAFE_INTEGER would reach the coupon-discount math
      // (totalUsd * qty) and could integer-overflow the float into Infinity.
      for (const it of body.items) {
        if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > MAX_LINE_QTY) {
          return status(400, { error: `qty must be 1..${MAX_LINE_QTY}`, code: "BAD_QTY" });
        }
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
        if (!body.email?.trim()) {
          return status(400, {
            error: "Email is required for guest checkout",
            code: "EMAIL_REQUIRED",
          });
        }
        // Length sanity: RFC-5321 caps email at 254 chars total. Reject early
        // so a 50KB email body doesn't hit argon2id below.
        if (body.email.length > 254) {
          return status(400, { error: "Email too long", code: "EMAIL_TOO_LONG" });
        }
        // Cheap shape check — a fully RFC-compliant regex isn't worth the
        // DoS risk; this rejects obvious garbage (no `@`, multiple `@`, no `.`).
        const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailShape.test(body.email.trim())) {
          return status(400, { error: "Invalid email", code: "BAD_EMAIL" });
        }
        const emailNorm = body.email.trim().toLowerCase();
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
      if (body.coupon?.trim()) {
        const c = (
          await db.select().from(coupons).where(eq(coupons.code, body.coupon.trim().toUpperCase()))
        )[0];
        const now = Date.now();
        const valid =
          c?.active &&
          (c.maxUses == null || c.usedCount < c.maxUses) &&
          (c.expiresAt == null || new Date(c.expiresAt).getTime() > now) &&
          totalUsd >= c.minOrderUsd;
        if (!valid)
          return status(400, { error: "Invalid or ineligible coupon", code: "BAD_COUPON" });
        const discount = c?.type === "percent" ? (totalUsd * c?.value) / 100 : c?.value;
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

      const orderId = `GG-${randomUUID().split("-")[0].toUpperCase()}`;

      // Allocate a unique HD index + address, reserve keys, insert order — all in one transaction.
      // The orders.address_index / ltc_address UNIQUE constraints are the hard race backstop.
      try {
        const result = await db.transaction(async (tx) => {
          const counter = await getSettingNumber("hd_next_index", 0);
          const maxRow = await tx
            .select({ m: sql<number>`coalesce(max(${orders.addressIndex}), -1)` })
            .from(orders);
          const addressIndex = Math.max(counter, Number(maxRow[0]?.m ?? -1) + 1);
          const ltcAddress = deriveReceiveAddress(xpub, addressIndex);

          for (const { product, variant, qty } of lines) {
            const okk = await reserveKeys(tx as any, product.id, orderId, qty, variant?.id);
            if (!okk)
              throw new Error(`OUT_OF_STOCK:${product.name}${variant ? ` (${variant.name})` : ""}`);
          }

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

          return { addressIndex, ltcAddress };
        });

        // Advance the monotonic counter AFTER a successful insert (UNIQUE backstops a race).
        await setSetting("hd_next_index", String(result.addressIndex + 1));

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
        return status(500, { error: "Checkout failed", code: "CHECKOUT_FAILED" });
      }
    },
    {
      optionalUser: true,
      body: t.Object({
        items: t.Array(
          t.Object({
            productId: t.String(),
            variantId: t.Optional(t.Nullable(t.String())),
            qty: t.Integer({ minimum: 1 }),
          }),
          { minItems: 1 },
        ),
        method: t.Optional(t.String()),
        coupon: t.Optional(t.String()),
        email: t.Optional(t.String()),
      }),
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
