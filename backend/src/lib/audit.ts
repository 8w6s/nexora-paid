import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { db } from "../db/connection.ts";
import { adminActions } from "../db/schema.ts";
import { recordAudit } from "./audit-log.ts";

// Best-effort admin audit log. A logging failure must never break the action it records.
//
// Writes to BOTH stores so the unified DB-Editor audit pane sees admin-2fa,
// blocklist, license, and update events alongside SQL-console mutations.
// adminActions stays primary for the legacy Admin → Activity Log UI; audit_log
// is the new unified surface (SQL pane, deep filtering, append-only contract).
export async function logAdminAction(
  adminEmail: string,
  action: string,
  detail?: string,
  meta?: { ip?: string; target?: string; success?: boolean },
): Promise<void> {
  try {
    await db
      .insert(adminActions)
      .values({ id: randomUUID(), adminEmail, action, detail: detail ?? null });
  } catch {
    // swallow — legacy audit loging is non-critical
  }
  try {
    recordAudit((db as unknown as { $client: Database }).$client, {
      actorEmail: adminEmail,
      actorIp: meta?.ip ?? null,
      action,
      target: meta?.target ?? null,
      statement: detail ?? null,
      success: meta?.success ?? true,
    });
  } catch {
    // swallow — unified audit_log mirror is best-effort
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
    | "forgot.sent"
    | "forgot.miss"
    | "forgot.throttled"
    | "reset.ok"
    | "reset.miss"
    | "reset.replay"
    | "reset.expired"
    | "reset.bad_token_shape"
    | "reset.user_gone"
    | "change_password.ok"
    | "change_password.bad_current"
    | "change_email.ok"
    | "change_email.bad_current"
    | "change_email.same"
    | "change_email.taken"
    | "account.delete.ok"
    | "account.delete.bad_current"
    | "customer_2fa.enable"
    | "customer_2fa.disable"
    | "customer_2fa.recover"
    | "customer_2fa.bad_code"
    | "customer_2fa.bad_backup",
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