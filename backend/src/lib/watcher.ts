import { and, eq, lte, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "../db/connection.ts";
import { orders, productKeys, products } from "../db/schema.ts";
import { getAddrStatus, paymentDecision } from "./explorer.ts";
import { markPaidAndDeliver } from "./inventory.ts";
import { hookBus } from "./plugin/hook-bus.ts";
import { getSetting, getSettingNumber } from "./settings.ts";

/**
 * DB-driven payment watcher. Holds no in-memory per-order state, so a restart loses nothing:
 * every tick re-reads payable orders from the DB and re-polls their persisted addresses.
 */

let running = false;
const POLL_INTERVAL_MS = 30_000;
// Concurrent address checks per tick. BlockCypher's keyless tier is ~3 req/s
// hard, so 5 concurrent + small per-call jitter keeps us under the limit
// while still draining the payable backlog faster than sequential 350ms gaps
// (which choked at ~85 active orders per 30s tick before tx overlap).
const TICK_CONCURRENCY = 5;

type DeliverHook = (orderId: string, email: string, keys: { name: string; code: string }[]) => void;
// Hard cap: ~1k subscribers is far above any plausible legitimate need
// (each SSE client + a handful of plugin hooks). If we ever exceed this
// we have either a leak in unsubscribe or a misuse — fail loud and refuse
// to grow the array further so onOrderDelivered iteration stays O(N) at
// a bounded N rather than degrading silently to seconds-per-delivery.
const DELIVER_HOOKS_MAX = 1000;
const deliverHooks: DeliverHook[] = [];
export function onOrderDelivered(hook: DeliverHook) {
  if (deliverHooks.length >= DELIVER_HOOKS_MAX) {
    console.warn(
      `[watcher] deliverHooks at cap (${DELIVER_HOOKS_MAX}); refusing new subscriber to bound delivery latency`,
    );
    return () => {
      // No-op unsubscribe — we never registered.
    };
  }
  deliverHooks.push(hook);
  return () => {
    const i = deliverHooks.indexOf(hook);
    if (i !== -1) deliverHooks.splice(i, 1);
  };
}

const PAYABLE = sql`${orders.status} in ('pending','awaiting_payment','underpaid')`;

/**
 * Expire payable orders past their window; release their reserved keys.
 *
 * Atomicity: each (status flip + key release) pair runs in a transaction so a
 * crash between the two halves can't leak keys forever. Before iter 18 this
 * was two separate awaits — if the process died after the status update but
 * before releaseKeys, those product_keys stayed "reserved" pointing at an
 * "expired" order. recoverStuckOrders() only inspects 'paid' orders, so the
 * leaked keys would never come back to "available" without manual DB surgery.
 *
 * The inside-tx UPDATE keeps the PAYABLE guard so a concurrent watcher tick
 * (or a payment that races the expiry) doesn't double-flip: only the
 * transaction whose UPDATE affects exactly one row proceeds to release.
 */
async function expireStaleOrders(): Promise<void> {
  const now = new Date();
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(PAYABLE, lte(orders.expiresAt, now)));
  if (stale.length === 0) return;
  for (const o of stale) {
    await db.transaction(async (tx) => {
      // SELECT-then-UPDATE guard. Drizzle's UPDATE result shape (.changes /
      // .rowsAffected) is version-dependent; relying on it for the
      // "someone else won the race" branch was fragile. SQLite serializes
      // writes inside a transaction, so re-reading the row here is
      // race-safe — only the first concurrent caller observes a payable
      // status; the rest bail out without releasing keys.
      const cur = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, o.id));
      const s = cur[0]?.status;
      if (s !== "pending" && s !== "awaiting_payment" && s !== "underpaid") return;
      await tx.update(orders).set({ status: "expired" }).where(eq(orders.id, o.id));
      await tx
        .update(productKeys)
        .set({ status: "available", orderId: null, reservedAt: null })
        .where(and(eq(productKeys.orderId, o.id), eq(productKeys.status, "reserved")));
    });
  }
}

/** Check one order against the blockchain and advance its state. */
async function checkOrder(
  o: typeof orders.$inferSelect,
  token: string | undefined,
  requiredConf: number,
  tol: number,
): Promise<void> {
  const status = await getAddrStatus(o.ltcAddress, token);
  const decision = paymentDecision(status, o.expectedLitoshi, requiredConf, tol);

  if (decision === "paid") {
    const delivered = await markPaidAndDeliver(
      o.id,
      status.txid ?? null,
      status.receivedLitoshi,
      status.maxConfirmations,
    );
    if (delivered) {
      // Snapshot the hook list before iterating: a hook's body may call its
      // own returned cleanup() (SSE clients commonly do this when they see
      // status_update=paid), which mutates deliverHooks via splice() and
      // would shift indexes mid-iteration → some hooks skipped.
      for (const h of [...deliverHooks]) {
        try {
          h(o.id, o.email, delivered);
        } catch (_e) {}
      }
      // Emit hooks for plugins (analytics, external webhooks, etc.)
      hookBus
        .emit("payment.paid", { orderId: o.id, userId: o.userId, amountUsd: o.totalUsd })
        .catch(() => {});
      // Emit per-product delivered hooks
      for (const dk of delivered) {
        hookBus
          .emit("product.delivered", {
            orderId: o.id,
            userId: o.userId,
            productId: "",
            deliveredKeys: [dk.code],
          })
          .catch(() => {});
      }
    }
  } else if (decision === "underpaid") {
    await db
      .update(orders)
      .set({
        status: "underpaid",
        receivedLitoshi: status.receivedLitoshi,
        confirmations: status.maxConfirmations,
      })
      .where(and(eq(orders.id, o.id), PAYABLE));
  } else {
    // waiting: record any partial/confirmation progress for the pay page
    if (
      status.receivedLitoshi !== o.receivedLitoshi ||
      status.maxConfirmations !== o.confirmations
    ) {
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
  // Bounded concurrency: TICK_CONCURRENCY parallel checks. p-limit guarantees
  // we never exceed the cap, so the upstream explorer rate-limit holds even
  // when payable.length is huge. Errors are swallowed per-order so one
  // explorer outage doesn't cancel sibling checks.
  const limit = pLimit(TICK_CONCURRENCY);
  await Promise.all(
    payable.map((o) =>
      limit(async () => {
        try {
          await checkOrder(o, token, requiredConf, tol);
        } catch (e) {
          console.error(
            `[watcher] checkOrder failed for ${o.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }),
    ),
  );
}

/** Start the background loop (idempotent — only one loop per process). */
export function startWatcher(): void {
  if (running) return;
  running = true;
  (async () => {
    for (;;) {
      try {
        await tick();
      } catch (e) {
        console.error(`[watcher] tick failed: ${e instanceof Error ? e.message : String(e)}`);
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
      const delivered = await markPaidAndDeliver(
        o.id,
        o.paidTxId,
        o.receivedLitoshi,
        o.confirmations,
      );
      // markPaidAndDeliver only acts on payable states; for an already-'paid' order it returns null,
      // so handle the crash-mid-delivery case directly here instead.
      if (!delivered) await redeliverPaid(o.id);
    }
  }
}

// Deliver reserved keys for an order already in 'paid' (crash-recovery path), idempotent.
// Emits hooks like the normal path so plugin analytics/webhooks see the same
// stream of events whether delivery happened in real time or via recovery.
// Previously recovery silently bypassed the hook bus, causing analytics
// double-count drift after crashes.
async function redeliverPaid(orderId: string): Promise<void> {
  const result = await db.transaction(async (tx) => {
    const reserved = await tx
      .select()
      .from(productKeys)
      .where(and(eq(productKeys.orderId, orderId), eq(productKeys.status, "reserved")));
    if (reserved.length === 0) return null;
    const now = new Date();
    const codes: string[] = [];
    for (const k of reserved) {
      codes.push(k.code);
      await tx
        .update(productKeys)
        .set({ status: "delivered", deliveredAt: now })
        .where(eq(productKeys.id, k.id));
      await tx
        .update(products)
        .set({ sold: sql`${products.sold} + 1` })
        .where(eq(products.id, k.productId));
    }
    await tx.update(orders).set({ deliveredAt: now }).where(eq(orders.id, orderId));
    const o = (await tx.select().from(orders).where(eq(orders.id, orderId)))[0];
    return { o, codes };
  });
  if (!result?.o) return;
  hookBus
    .emit("payment.paid", {
      orderId: result.o.id,
      userId: result.o.userId,
      amountUsd: result.o.totalUsd,
    })
    .catch(() => {});
  for (const code of result.codes) {
    hookBus
      .emit("product.delivered", {
        orderId: result.o.id,
        userId: result.o.userId,
        productId: "",
        deliveredKeys: [code],
      })
      .catch(() => {});
  }
}
