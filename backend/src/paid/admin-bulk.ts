/**
 * Paid module: admin bulk operations on products.
 *
 * Endpoints:
 *  - `POST /api/admin/products/bulk-delete`   → soft-deactivate (active=false)
 *  - `POST /api/admin/products/bulk-activate` → re-activate (active=true)
 *
 * Both mirror the existing single-row `DELETE /api/admin/products/:id`
 * semantics: SOFT toggle of the `active` column so order history that
 * references the product still resolves. Hard-deleting would orphan
 * order rows.
 *
 * Why this is a Paid module and not part of adminRoutes:
 *  - Not on the Free baseline (Free admins live with single-row
 *    delete/edit). Belongs to the Cluster F admin QoL bundle.
 *  - Auth is re-checked inline (see `requireAdmin` below) because
 *    Elysia plugins don't share `.onBeforeHandle` state across
 *    `.use()` boundaries — paid modules attach to the root app, not
 *    inside the adminRoutes plugin scope.
 *
 * Audit: each bulk op logs ONE aggregated row
 * (`product.bulk_deactivate` / `product.bulk_activate`) with the count
 * and acting admin email, so the activity log shows scope without
 * spamming N rows.
 */
import { type Cookie, t } from "elysia";
import { inArray } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { products } from "../db/schema.ts";
import { validateSession, SESSION_COOKIE, type SessionUser } from "../lib/auth.ts";
import { logAdminAction } from "../lib/audit.ts";
import type { PaidModule } from "../lib/paid-modules.ts";

const MAX_BULK = 200; // Cap a single bulk op so a runaway client can't flip the whole catalog.

// Inline auth gate — see file header for why we can't piggyback on adminRoutes.
// Returns the SessionUser on success, or `null` to signal the caller should
// respond with the matching status code (already set on `status`).
async function requireAdmin(
  cookie: Record<string, Cookie<string | undefined>>,
  status: (code: number, body: unknown) => unknown,
): Promise<{ user: SessionUser } | { errorResponse: unknown }> {
  const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
  if (!user) return { errorResponse: status(401, { error: "Authentication required", code: "UNAUTHENTICATED" }) };
  if (user.role !== "admin") return { errorResponse: status(403, { error: "Admin only", code: "FORBIDDEN" }) };
  return { user };
}

// Shared bulk-toggle implementation. `target` is the new value of
// products.active; `verb` differentiates the audit action + error messages.
async function bulkToggleActive(
  ids: string[],
  target: boolean,
  user: SessionUser,
  status: (code: number, body: unknown) => unknown,
): Promise<unknown> {
  const verb = target ? "activate" : "deactivate";

  // Dedup and drop empty strings — Elysia validated each is a string but
  // not that they're non-empty or unique.
  const cleanIds = Array.from(new Set(ids.filter((s) => typeof s === "string" && s.length > 0)));
  if (cleanIds.length === 0) return status(400, { error: "No product IDs provided", code: "EMPTY_IDS" });
  if (cleanIds.length > MAX_BULK) {
    return status(400, { error: `Cannot bulk-${verb} more than ${MAX_BULK} at once`, code: "TOO_MANY" });
  }

  // Look up which IDs actually exist before touching — gives the client
  // an accurate "matched" count and avoids logging a fake bulk op when
  // nothing in the list was real.
  const matched = await db.select({ id: products.id }).from(products).where(inArray(products.id, cleanIds));
  const matchedIds = matched.map((r) => r.id);
  if (matchedIds.length === 0) return status(404, { error: "No matching products", code: "NOT_FOUND" });

  await db.update(products).set({ active: target }).where(inArray(products.id, matchedIds));
  await logAdminAction(user.email, `product.bulk_${target ? "activate" : "deactivate"}`, `${matchedIds.length} product(s)`);

  return {
    ok: true,
    [target ? "activated" : "deactivated"]: matchedIds.length,
    ids: matchedIds,
    skipped: cleanIds.length - matchedIds.length,
  };
}

const bulkBody = {
  body: t.Object({ ids: t.Array(t.String(), { minItems: 1 }) }),
};

export const adminBulkModule: PaidModule = {
  id: "admin-bulk",
  description: "Admin bulk ops (POST /api/admin/products/bulk-{delete,activate})",
  register: (app) =>
    app
      .post(
        "/api/admin/products/bulk-delete",
        async ({ body, cookie, status }) => {
          const auth = await requireAdmin(cookie, status);
          if ("errorResponse" in auth) return auth.errorResponse;
          return bulkToggleActive(body.ids, false, auth.user, status);
        },
        bulkBody,
      )
      .post(
        "/api/admin/products/bulk-activate",
        async ({ body, cookie, status }) => {
          const auth = await requireAdmin(cookie, status);
          if ("errorResponse" in auth) return auth.errorResponse;
          return bulkToggleActive(body.ids, true, auth.user, status);
        },
        bulkBody,
      ),
};
