import { randomUUID } from "crypto";
import { db } from "../db/connection.ts";
import { adminActions } from "../db/schema.ts";

// Best-effort admin audit log. A logging failure must never break the action it records.
export async function logAdminAction(adminEmail: string, action: string, detail?: string): Promise<void> {
  try {
    await db.insert(adminActions).values({ id: randomUUID(), adminEmail, action, detail: detail ?? null });
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
export async function logAuthEvent(email: string, action: "login.ok" | "login.fail" | "login.locked" | "register" | "logout" | "register.dup" | "login.banned", ip: string, detail?: string): Promise<void> {
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
