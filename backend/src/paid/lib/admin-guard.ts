/**
 * Shared admin auth gate for Paid modules.
 *
 * Paid modules attach to the root app, not inside the adminRoutes plugin
 * scope, so Elysia's `.onBeforeHandle` from adminRoutes doesn't apply
 * to their handlers. Every Paid admin endpoint must re-check the
 * session itself — this helper makes that one line per handler.
 *
 * Usage:
 *   const auth = await requireAdmin(cookie, status);
 *   if ("errorResponse" in auth) return auth.errorResponse;
 *   // auth.user is SessionUser here
 *
 * Hoisted out of admin-bulk.ts + admin-export.ts in iter 10 when the
 * third call site (admin-customers-csv.ts) landed — rule of three.
 */
import type { Cookie } from "elysia";
import { SESSION_COOKIE, type SessionUser, validateSession } from "../../lib/auth.ts";

export async function requireAdmin(
  cookie: Record<string, Cookie<string | undefined>>,
  status: (code: number, body: unknown) => unknown,
): Promise<{ user: SessionUser } | { errorResponse: unknown }> {
  const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
  if (!user)
    return {
      errorResponse: status(401, { error: "Authentication required", code: "UNAUTHENTICATED" }),
    };
  if (user.role !== "admin")
    return { errorResponse: status(403, { error: "Admin only", code: "FORBIDDEN" }) };
  return { user };
}
