import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { orders, products, productKeys } from "../db/schema.ts";
import { getAddrStatus, paymentDecision } from "./explorer.ts";
import { markPaidAndDeliver, releaseKeys } from "./inventory.ts";
import { getSetting, getSettingNumber } from "./settings.ts";

/**
 * DB-driven payment watcher. Holds no in-memory per-order state, so a restart loses nothing:
 * every tick re-reads payable orders from the DB and re-polls their persisted addresses.
 */

let running = false;
const POLL_INTERVAL_MS = 30_000;
const PER_ADDRESS_DELAY_MS = 350; // stay under ~3 req/s

type DeliverHook = (orderId: string, email: string, keys: { name: string; code: string }[]) => void;
let onDelivered: DeliverHook | null = null;
export function onOrderDelivered(hook: DeliverHook) {
  onDelivered = hook;
}

const PAYABLE = sql`${orders.status} in ('pending','awaiting_payment','underpaid')`;

/** Expire payable orders past their window; release their reserved keys. */
async function expireStaleOrders(): Promise<void> {
  const now = new Date();
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(PAYABLE, lte(orders.expiresAt, now)));
  if (stale.length === 0) return;
  for (const o of stale) {
    await db.update(orders).set({ status: "expired" }).where(and(eq(orders.id, o.id), PAYABLE));
    await releaseKeys(o.id);
  }
  if (stale.length) console.log(`[watcher] expired ${stale.length} stale order(s), keys released.`);
}

/** Check one order against the blockchain and advance its state. */
async function checkOrder(o: typeof orders.$inferSelect, token: string | undefined, requiredConf: number, tol: number): Promise<void> {
  const status = await getAddrStatus(o.ltcAddress, token);
  const decision = paymentDecision(status, o.expectedLitoshi, requiredConf, tol);

  if (decision === "paid") {
    const delivered = await markPaidAndDeliver(o.id, status.txid ?? null, status.receivedLitoshi, status.maxConfirmations);
    if (delivered) {
      console.log(`[watcher] order ${o.id} PAID & delivered ${delivered.length} key(s).`);
      onDelivered?.(o.id, o.email, delivered);
    }
  } else if (decision === "underpaid") {
    await db
      .update(orders)
      .set({ status: "underpaid", receivedLitoshi: status.receivedLitoshi, confirmations: status.maxConfirmations })
      .where(and(eq(orders.id, o.id), PAYABLE));
  } else {
    // waiting: record any partial/confirmation progress for the pay page
    if (status.receivedLitoshi !== o.receivedLitoshi || status.maxConfirmations !== o.confirmations) {
      await db
        .update(orders)
        .set({ receivedLitoshi: status.receivedLitoshi, confirmations: status.maxConfirmations })
        .where(and(eq(orders.id, o.id), PAYABLE));
    }
  }
}

async function tick(): Promise<void> {
  await expireStaleOrders();
  const token = (await getSetting("blockcypher_token")) ?? undefined;
  const requiredConf = await getSettingNumber("required_confirmations", 2);
  const tol = await getSettingNumber("rate_tolerance_litoshi", 1000);

  const payable = await db.select().from(orders).where(PAYABLE);
  for (const o of payable) {
    try {
      await checkOrder(o, token, requiredConf, tol);
    } catch (e) {
      console.warn(`[watcher] order ${o.id} check failed:`, e instanceof Error ? e.message : e);
    }
    await Bun.sleep(PER_ADDRESS_DELAY_MS);
  }
}

/** Start the background loop (idempotent — only one loop per process). */
export function startWatcher(): void {
  if (running) return;
  running = true;
  console.log("[watcher] started (DB-driven, 30s interval).");
  (async () => {
    for (;;) {
      try {
        await tick();
      } catch (e) {
        console.warn("[watcher] tick error:", e instanceof Error ? e.message : e);
      }
      await Bun.sleep(POLL_INTERVAL_MS);
    }
  })();
}

/**
 * Restart recovery. Timers die on process exit, but all order state is persisted, so recovery
 * is just: expire anything past its window (release keys), and re-deliver any 'paid' order that
 * may have crashed mid-delivery (idempotent). The running loop then handles everything else.
 */
export async function recoverStuckOrders(): Promise<void> {
  await expireStaleOrders();
  // 'paid' but maybe not delivered (crash between flip and delivery): re-run idempotent deliver.
  const paid = await db.select().from(orders).where(eq(orders.status, "paid"));
  for (const o of paid) {
    if (!o.deliveredAt) {
      const delivered = await markPaidAndDeliver(o.id, o.paidTxId, o.receivedLitoshi, o.confirmations);
      // markPaidAndDeliver only acts on payable states; for an already-'paid' order it returns null,
      // so handle the crash-mid-delivery case directly here instead.
      if (!delivered) await redeliverPaid(o.id);
    }
  }
  if (paid.length) console.log(`[watcher] recovery scanned ${paid.length} paid order(s).`);
}

// Deliver reserved keys for an order already in 'paid' (crash-recovery path), idempotent.
async function redeliverPaid(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const reserved = await tx
      .select()
      .from(productKeys)
      .where(and(eq(productKeys.orderId, orderId), eq(productKeys.status, "reserved")));
    if (reserved.length === 0) return;
    const now = new Date();
    for (const k of reserved) {
      await tx.update(productKeys).set({ status: "delivered", deliveredAt: now }).where(eq(productKeys.id, k.id));
      await tx.update(products).set({ sold: sql`${products.sold} + 1` }).where(eq(products.id, k.productId));
    }
    await tx.update(orders).set({ deliveredAt: now }).where(eq(orders.id, orderId));
  });
}
