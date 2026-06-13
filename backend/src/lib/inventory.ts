import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { orders, productKeys, products } from "../db/schema.ts";
import { EmailService } from "./email.ts";

/**
 * Key inventory operations. All stock state lives in product_keys:
 *   available → reserved (at checkout) → delivered (on confirmed payment)
 *   reserved → available (on cancel / expiry)
 * Concurrency safety for delivery is enforced by the idempotent order status transition
 * (markPaidAndDeliver), so only the first poll tick that flips the order actually delivers.
 */

export async function availableCount(productId: string): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(productKeys)
    .where(and(eq(productKeys.productId, productId), eq(productKeys.status, "available")));
  return Number(rows[0]?.c ?? 0);
}

/**
 * Reserve `qty` available keys for an order, inside a transaction. Returns false (rolls back)
 * if not enough available — so checkout can reject as out-of-stock without partial reservation.
 */
export async function reserveKeys(
  tx: typeof db,
  productId: string,
  orderId: string,
  qty: number,
  variantId: string | null = null,
): Promise<boolean> {
  const avail = await tx
    .select({ id: productKeys.id })
    .from(productKeys)
    .where(
      and(
        eq(productKeys.productId, productId),
        variantId ? eq(productKeys.variantId, variantId) : sql`${productKeys.variantId} IS NULL`,
        eq(productKeys.status, "available"),
      ),
    )
    .limit(qty);
  if (avail.length < qty) return false;
  const now = new Date();
  for (const row of avail) {
    await tx
      .update(productKeys)
      .set({ status: "reserved", orderId, reservedAt: now })
      .where(and(eq(productKeys.id, row.id), eq(productKeys.status, "available")));
  }

  // Low stock check
  const remaining = await tx
    .select({ c: sql<number>`count(*)` })
    .from(productKeys)
    .where(
      and(
        eq(productKeys.productId, productId),
        variantId ? eq(productKeys.variantId, variantId) : sql`${productKeys.variantId} IS NULL`,
        eq(productKeys.status, "available"),
      ),
    );
  const remainingCount = Number(remaining[0]?.c ?? 0);
  if (remainingCount < 3) {
    const prod = (
      await tx.select({ name: products.name }).from(products).where(eq(products.id, productId))
    )[0];
    const prodName = prod?.name ?? productId;
    const adminEmail = Bun.env.ADMIN_EMAIL;
    if (adminEmail) {
      EmailService.lowStockAlert(adminEmail, prodName, remainingCount).catch((_e) => {});
    }
  }

  return true;
}

/** Release an order's reserved keys back to available (cancel / expire). */
export async function releaseKeys(orderId: string): Promise<void> {
  await db
    .update(productKeys)
    .set({ status: "available", orderId: null, reservedAt: null })
    .where(and(eq(productKeys.orderId, orderId), eq(productKeys.status, "reserved")));
}

/**
 * Idempotent "mark paid + deliver". Flips the order pending/underpaid → paid ONLY if it is
 * still in a payable state (affected rows == 1 guard), then converts that order's reserved
 * keys → delivered and bumps product.sold. Safe under concurrent poll ticks: only the first
 * caller whose UPDATE affects a row performs delivery.
 *
 * Returns the delivered key codes (grouped) when this call did the delivery, or null if the
 * order was already non-payable (someone else delivered / it was cancelled/expired).
 */
export async function markPaidAndDeliver(
  orderId: string,
  txId: string | null,
  receivedLitoshi: number,
  confirmations: number,
): Promise<{ name: string; code: string }[] | null> {
  return db.transaction(async (tx) => {
    // Idempotent guard: only flips a still-payable order.
    const res = await tx
      .update(orders)
      .set({
        status: "paid",
        paidTxId: txId,
        receivedLitoshi,
        confirmations,
        paidAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          sql`${orders.status} in ('pending','awaiting_payment','underpaid')`,
        ),
      );

    // drizzle bun-sqlite: .run() result has `changes`. The update above returns a result we can inspect.
    const affected = (res as any)?.changes ?? (res as any)?.rowsAffected ?? 0;
    if (affected !== 1) return null; // someone else handled it, or not payable

    // Convert this order's reserved keys → delivered.
    const reserved = await tx
      .select()
      .from(productKeys)
      .where(and(eq(productKeys.orderId, orderId), eq(productKeys.status, "reserved")));
    const now = new Date();
    for (const k of reserved) {
      await tx
        .update(productKeys)
        .set({ status: "delivered", deliveredAt: now })
        .where(eq(productKeys.id, k.id));
      await tx
        .update(products)
        .set({ sold: sql`${products.sold} + 1` })
        .where(eq(products.id, k.productId));
    }

    // Build delivered payload (name from product) for display/email.
    const delivered: { name: string; code: string }[] = [];
    for (const k of reserved) {
      const p = (await tx.select().from(products).where(eq(products.id, k.productId)))[0];
      delivered.push({ name: p?.name ?? "Item", code: k.code });
    }
    await tx.update(orders).set({ deliveredAt: now }).where(eq(orders.id, orderId));
    return delivered;
  });
}
