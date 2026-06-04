/**
 * Paid module: admin revenue chart data.
 *
 * `GET /api/admin/stats/revenue?days=30` returns per-day USD revenue
 * buckets for paid + completed orders over the last N days
 * (default 30, clamped to [1, 365]). Frontend consumes this as the
 * data for a small chart on the admin dashboard.
 *
 * Bucket model:
 *  - One bucket per UTC day so two admins in different timezones see
 *    the same buckets (avoids "today" being a 36-hour edge-day window).
 *  - Buckets include zero-revenue days so the chart's X-axis stays
 *    evenly spaced — never `[Mon: $42, Wed: $19]` skipping Tue.
 *  - Revenue uses `totalUsd` (locked at checkout). Refunds/cancels are
 *    out of scope here; we count orders that reached paid/completed.
 *
 * Why a Paid module: Cluster F admin QoL bundle. Free admins stay with
 * the existing /api/admin/overview totals.
 *
 * NOTE: no audit log — this endpoint is read-only and called frequently
 * by the dashboard. Spamming activity rows would drown out write events.
 */
import { t } from "elysia";
import { and, gte, inArray } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { orders } from "../db/schema.ts";
import type { PaidModule } from "../lib/paid-modules.ts";
import { requireAdmin } from "./lib/admin-guard.ts";

const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

// UTC `YYYY-MM-DD` key for a Date — same shape used in CSV export
// filenames. Kept local rather than importing from lib/csv so a future
// reshape of csv.ts doesn't pull this endpoint's date logic with it.
function utcDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const adminStatsModule: PaidModule = {
  id: "admin-stats",
  description: "Admin revenue chart (GET /api/admin/stats/revenue)",
  register: (app) =>
    app.get(
      "/api/admin/stats/revenue",
      async ({ cookie, status, query }) => {
        const auth = await requireAdmin(cookie, status);
        if ("errorResponse" in auth) return auth.errorResponse;

        // Parse + clamp `days`. Elysia validates the type but not the
        // range; clamp here so an admin can't accidentally bucket 100 years.
        const raw = Number(query.days ?? DEFAULT_DAYS);
        const days = Number.isFinite(raw)
          ? Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(raw)))
          : DEFAULT_DAYS;

        // Window: start of (today - days + 1) UTC, inclusive.
        const now = new Date();
        const startUtc = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1,
        ));

        const rows = await db
          .select({ createdAt: orders.createdAt, totalUsd: orders.totalUsd })
          .from(orders)
          .where(and(
            gte(orders.createdAt, startUtc),
            inArray(orders.status, ["paid", "completed"] as never[]),
          ));

        // Pre-seed every bucket with 0 so missing days still appear.
        const buckets = new Map<string, { dayUtc: string; revenueUsd: number; orders: number }>();
        for (let i = 0; i < days; i++) {
          const d = new Date(Date.UTC(
            startUtc.getUTCFullYear(), startUtc.getUTCMonth(), startUtc.getUTCDate() + i,
          ));
          const key = utcDay(d);
          buckets.set(key, { dayUtc: key, revenueUsd: 0, orders: 0 });
        }
        for (const r of rows) {
          const key = utcDay(r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as number));
          const b = buckets.get(key);
          if (!b) continue; // out-of-window safety net (timestamp drift, etc.)
          b.revenueUsd += r.totalUsd;
          b.orders += 1;
        }

        return {
          days,
          totalRevenueUsd: Array.from(buckets.values()).reduce((s, b) => s + b.revenueUsd, 0),
          totalOrders: Array.from(buckets.values()).reduce((s, b) => s + b.orders, 0),
          buckets: Array.from(buckets.values()), // already in chronological order (insertion order)
        };
      },
      {
        query: t.Object({ days: t.Optional(t.String()) }),
      },
    ),
};
