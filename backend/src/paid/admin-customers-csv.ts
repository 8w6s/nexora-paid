/**
 * Paid module: CSV export of customers.
 *
 * `GET /api/admin/customers/export.csv` streams the users table as
 * RFC-4180 CSV. Admin-gated. Filename:
 * `nexora-customers-<YYYY-MM-DD>.csv`.
 *
 * The export INCLUDES customer + admin rows (filter via `?role=customer`
 * for buyers-only). It EXCLUDES `passwordHash` — that hash is a secret
 * even from the admin who triggered the export.
 *
 * Audit: logs `customers.csv_export` with row count + role filter.
 */
import { t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import type { PaidModule } from "../lib/paid-modules.ts";
import { requireAdmin } from "./lib/admin-guard.ts";
import { csvBody, todayStamp } from "./lib/csv.ts";

// passwordHash deliberately omitted — never leaves the system, even to admins.
const CSV_COLUMNS = ["id", "email", "role", "status", "createdAt"] as const;

export const adminCustomersCsvModule: PaidModule = {
  id: "admin-customers-csv",
  description: "Admin CSV export (GET /api/admin/customers/export.csv)",
  register: (app) =>
    app.get(
      "/api/admin/customers/export.csv",
      async ({ cookie, status, set, query }) => {
        const auth = await requireAdmin(cookie, status);
        if ("errorResponse" in auth) return auth.errorResponse;

        const q = query as Record<string, string>;
        const rows = q.role
          ? await db.select().from(users).where(eq(users.role, q.role as never)).orderBy(desc(users.createdAt))
          : await db.select().from(users).orderBy(desc(users.createdAt));

        // Strip passwordHash defensively even though it's not in CSV_COLUMNS —
        // belt-and-braces in case the column list is extended carelessly later.
        const safeRows = rows.map(({ passwordHash: _ph, ...rest }) => rest as Record<string, unknown>);
        const csv = csvBody(CSV_COLUMNS, safeRows);

        const stamp = todayStamp(new Date());
        set.headers["content-type"] = "text/csv; charset=utf-8";
        set.headers["content-disposition"] = `attachment; filename="nexora-customers-${stamp}.csv"`;

        await logAdminAction(auth.user.email, "customers.csv_export", `${rows.length} row(s)${q.role ? ` (role=${q.role})` : ""}`);
        return csv;
      },
      {
        query: t.Optional(t.Object({ role: t.Optional(t.String()) })),
      },
    ),
};
