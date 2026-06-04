/**
 * Paid module: admin bulk operations on products.
 *
 * Adds `POST /api/admin/products/bulk-delete` so an admin can deactivate
 * many products in one round-trip. Mirrors the existing single-row
 * `DELETE /api/admin/products/:id` semantics: SOFT delete (sets
 * `active: false`) so order history that references the product still
 * resolves. Hard-deleting would orphan order rows.
 *
 * Why this is a Paid module and not part of adminRoutes:
 *  - It's not on the Free baseline (Free admins live with single-row
 *    deletes). Belongs to the Cluster F admin QoL bundle.
 *  - Auth is re-checked in this module's own `.onBeforeHandle` instead
 *    of piggy-backing on adminRoutes' guard, because Elysia plugins
 *    don't share `.onBeforeHandle` state across `.use()` boundaries.
 *    A tiny re-implementation here is cheaper than refactoring the
 *    admin guard into a shared helper just to please one route.
 *
 * Audit: every bulk-delete logs one `product.bulk_deactivate` row with
 * the count + acting admin email so the activity log shows aggregate
 * scope without spamming N rows.
 */
import { Elysia, t } from "elysia";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { products } from "../db/schema.ts";
import { validateSession, SESSION_COOKIE } from "../lib/auth.ts";
import { logAdminAction } from "../lib/audit.ts";
import type { PaidModule } from "../lib/paid-modules.ts";

const MAX_BULK = 200; // Cap a single bulk op so a runaway client can't deactivate the whole catalog.

export const adminBulkModule: PaidModule = {
  id: "admin-bulk",
  description: "Admin bulk ops (POST /api/admin/products/bulk-delete)",
  register: (app) =>
    app.post(
      "/api/admin/products/bulk-delete",
      async ({ body, cookie, status }) => {
        // Auth: admin session required. Re-check here because paid modules
        // attach to the root app, not inside the adminRoutes plugin scope.
        const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
        if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
        if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });

        const ids = Array.from(new Set(body.ids.filter((s) => typeof s === "string" && s.length > 0)));
        if (ids.length === 0) return status(400, { error: "No product IDs provided", code: "EMPTY_IDS" });
        if (ids.length > MAX_BULK) return status(400, { error: `Cannot bulk-delete more than ${MAX_BULK} at once`, code: "TOO_MANY" });

        // Look up which IDs actually exist before touching — gives the
        // client an accurate "matched" count and avoids logging a fake
        // bulk op when nothing in the list was real.
        const matched = await db.select({ id: products.id }).from(products).where(inArray(products.id, ids));
        const matchedIds = matched.map((r) => r.id);
        if (matchedIds.length === 0) return status(404, { error: "No matching products", code: "NOT_FOUND" });

        await db.update(products).set({ active: false }).where(inArray(products.id, matchedIds));
        await logAdminAction(user.email, "product.bulk_deactivate", `${matchedIds.length} product(s)`);

        return { ok: true, deactivated: matchedIds.length, ids: matchedIds, skipped: ids.length - matchedIds.length };
      },
      {
        body: t.Object({
          ids: t.Array(t.String(), { minItems: 1 }),
        }),
      },
    ),
};
