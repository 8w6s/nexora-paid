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
