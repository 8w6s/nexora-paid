/**
 * Paid module: CSV export of orders.
 *
 * `GET /api/admin/orders/export.csv` streams the full orders table as
 * RFC-4180 CSV with a Content-Disposition attachment so the browser
 * saves it as `nexora-orders-<YYYY-MM-DD>.csv`. Admin-gated.
 *
 * Scope choices:
 *  - All orders, not just paid — admin may want to audit cancellations
 *    and underpaid attempts too. Filter with `?status=paid` if needed
 *    (client-side filtering is fine for a CSV; nobody pipes this).
 *  - Top-level fields only (no per-item join). A second endpoint can
 *    export order_items later if anyone asks; flattening 1-to-many
 *    in a single CSV usually confuses spreadsheets.
 *  - We stream the whole table in one query rather than paginate.
 *    Even a busy shop's lifetime orders are << 100k rows; if the table
 *    ever grows past that, swap to a cursor pager and stream chunks
 *    (Elysia supports ReadableStream responses).
 *
 * Why a Paid module: bulk export is Cluster F admin QoL — Free admins
 * stay on the single-row view + manual copy.
 *
 * Audit: each export logs `orders.csv_export` with the row count so the
 * activity log shows when data left the system.
 */
import { type Cookie, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { orders } from "../db/schema.ts";
import { validateSession, SESSION_COOKIE, type SessionUser } from "../lib/auth.ts";
import { logAdminAction } from "../lib/audit.ts";
import type { PaidModule } from "../lib/paid-modules.ts";

// Inline auth gate — paid modules attach to the root app, not inside
// the adminRoutes plugin scope, so we can't share its .onBeforeHandle.
async function requireAdmin(
  cookie: Record<string, Cookie<string | undefined>>,
  status: (code: number, body: unknown) => unknown,
): Promise<{ user: SessionUser } | { errorResponse: unknown }> {
  const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
  if (!user) return { errorResponse: status(401, { error: "Authentication required", code: "UNAUTHENTICATED" }) };
  if (user.role !== "admin") return { errorResponse: status(403, { error: "Admin only", code: "FORBIDDEN" }) };
  return { user };
}

// RFC-4180 CSV cell escape: wrap in double quotes and escape inner
// double quotes by doubling. Always quote so commas, newlines, and
// leading/trailing whitespace stay intact across spreadsheet apps.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

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

function todayStamp(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const adminExportModule: PaidModule = {
  id: "admin-export",
  description: "Admin CSV export (GET /api/admin/orders/export.csv)",
  register: (app) =>
    app.get(
      "/api/admin/orders/export.csv",
      async ({ cookie, status, set, query }) => {
        const auth = await requireAdmin(cookie, status);
        if ("errorResponse" in auth) return auth.errorResponse;

        const q = query as Record<string, string>;
        const rows = q.status
          ? await db.select().from(orders).where(eq(orders.status, q.status as never)).orderBy(desc(orders.createdAt))
          : await db.select().from(orders).orderBy(desc(orders.createdAt));

        const header = CSV_COLUMNS.join(",");
        const body = rows
          .map((r) =>
            CSV_COLUMNS.map((col) => csvCell((r as Record<string, unknown>)[col])).join(","),
          )
          .join("\r\n");
        // RFC-4180 line ending is CRLF; trailing CRLF is optional but
        // some tools expect the file to end with a newline.
        const csv = `${header}\r\n${body}${rows.length ? "\r\n" : ""}`;

        const stamp = todayStamp(new Date());
        set.headers["content-type"] = "text/csv; charset=utf-8";
        set.headers["content-disposition"] = `attachment; filename="nexora-orders-${stamp}.csv"`;

        await logAdminAction(auth.user.email, "orders.csv_export", `${rows.length} row(s)${q.status ? ` (status=${q.status})` : ""}`);
        return csv;
      },
      {
        query: t.Optional(t.Object({ status: t.Optional(t.String()) })),
      },
    ),
};
