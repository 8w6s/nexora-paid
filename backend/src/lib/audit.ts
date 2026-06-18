import { randomUUID } from "node:crypto";
import { db } from "../db/connection.ts";
import { adminActions } from "../db/schema.ts";

// Best-effort admin audit log. A logging failure must never break the action it records.
export async function logAdminAction(
  adminEmail: string,
  action: string,
  detail?: string,
): Promise<void> {
  try {
    await db
      .insert(adminActions)
      .values({ id: randomUUID(), adminEmail, action, detail: detail ?? null });
  } catch {
    // swallow — audit logging is non-critical
  }
}

/**
 * Customer auth audit. We reuse the admin_actions table (same shape) but with
 * a synthetic actor "auth:<email>" so admins can grep the activity log for
 * any account's auth history. Storing both successful AND failed events lets
 * an operator notice credential stuffing patterns even when the per-account
 * lockout silently absorbed the brute force.
 */
export async function logAuthEvent(
  email: string,
  action:
    | "login.ok"
    | "login.fail"
    | "login.locked"
    | "login.2fa_fail"
    | "register"
    | "logout"
    | "register.dup"
    | "login.banned"
    // Password-reset flow (customer self-service). throttled/miss never
    // confirm the email exists — they're surfaced anyway so an operator
    // grepping the audit log can see probing patterns.
    | "forgot.sent"
    | "forgot.miss"
    | "forgot.throttled"
    | "reset.ok"
    | "reset.miss"
    | "reset.replay"
    | "reset.expired"
    | "reset.bad_token_shape"
    | "reset.user_gone"
    // Logged-in self-service password change (customer-side counterpart of
    // the AdminTeam rotation card). bad_current covers "current password
    // didn't match" so probing patterns surface in the activity log.
    | "change_password.ok"
    | "change_password.bad_current",
  ip: string,
  detail?: string,
): Promise<void> {
  try {
    await db.insert(adminActions).values({
      id: randomUUID(),
      adminEmail: `auth:${email || "unknown"}`,
      action,
      detail: `${ip}${detail ? ` ${detail}` : ""}`,
    });
  } catch {
    // swallow — auth events should never block the auth path itself
  }
}
