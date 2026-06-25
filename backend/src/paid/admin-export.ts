/**
 * Paid module: CSV export of orders.
 *
 * `GET /api/admin/orders/export.csv` streams the full orders table as
 * RFC-4180 CSV with a Content-Disposition attachment so the browser
 * saves it as `nexora-orders-<YYYY-MM-DD>.csv`. Admin-gated.
 *
 * Top-level order fields only (no per-item join). A separate endpoint
 * can export order_items later if anyone asks; flattening 1-to-many
 * in a single CSV usually confuses spreadsheets.
 *
 * Stream-via-single-query: reasonable shops have << 100k lifetime
 * orders. If ever exceeded, swap to a cursor pager + ReadableStream
 * chunks (Elysia supports it).
 *
 * Audit: each export logs `orders.csv_export` with row count + filter.
 *
 * iter 10 refactor: requireAdmin + csvCell hoisted to paid/lib/. This
 * module now only owns the route + the orders-specific column list.
 */

import { desc, eq } from "drizzle-orm";
import { t } from "elysia";
import { db } from "../db/connection.ts";
import { orders } from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import type { Plugin } from "../lib/plugin/types.ts";
import { requireAdmin } from "./lib/admin-guard.ts";
import { csvBody, todayStamp } from "./lib/csv.ts";

const CSV_COLUMNS = [
  "id",
  "createdAt",
  "email",
  "status",
  "totalUsd",
  "ltcAmount",
  "ltcAddress",
  "paidTxId",
  "paidAt",
  "deliveredAt",
] as const;

// Allowlist mirrors the orders.status union in the schema. Anything else is
// silently treated as "no filter" rather than passed through to drizzle —
// avoids surprising query failures from typos or hostile inputs.
const ORDER_STATUSES = new Set([
  "pending",
  "awaiting_payment",
  "underpaid",
  "paid",
  "completed",
  "expired",
  "cancelled",
]);

export const adminExportPlugin: Plugin = {
  manifest: {
    id: "admin-export",
    version: "1.0.0",
    nexoraVersion: ">=0.2 <0.3",
    description: "Admin CSV export (GET /api/admin/orders/export.csv)",
  },
  register: (app) =>
    app.get(
      "/api/admin/orders/export.csv",
      async ({ cookie, status, set, query }: any) => {
        const auth = await requireAdmin(cookie, status);
        if ("errorResponse" in auth) return auth.errorResponse;

        const q = query as Record<string, string>;
        const statusFilter = q.status && ORDER_STATUSES.has(q.status) ? q.status : null;
        const rows = statusFilter
          ? await db
              .select()
              .from(orders)
              .where(eq(orders.status, statusFilter as never))
              .orderBy(desc(orders.createdAt))
          : await db.select().from(orders).orderBy(desc(orders.createdAt));

        const csv = csvBody(CSV_COLUMNS, rows as Record<string, unknown>[]);

        const stamp = todayStamp(new Date());
        set.headers["content-type"] = "text/csv; charset=utf-8";
        set.headers["content-disposition"] = `attachment; filename="nexora-orders-${stamp}.csv"`;

        await logAdminAction(
          auth.user.email,
          "orders.csv_export",
          `${rows.length} row(s)${statusFilter ? ` (status=${statusFilter})` : ""}`,
        );
        return csv;
      },
      {
        query: t.Optional(t.Object({ status: t.Optional(t.String()) })),
      },
    ),
};
