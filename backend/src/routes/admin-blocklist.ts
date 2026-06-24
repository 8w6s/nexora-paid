import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { blocklist } from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";

/**
 * Anti-fraud blocklist + allowlist routes.
 *
 * Both modes share one table because the shape is identical (type, value,
 * note, timestamp); a `mode` column with a CHECK constraint disambiguates
 * without splitting storage. The AdminBlacklist tab toggles between
 * /api/admin/blacklist and /api/admin/whitelist against the same backend
 * surface.
 * Pre-MVP these routes 404'd silently because the frontend was wired but
 * no backend ever landed; this file closes that gap. Lives in its own
 * Elysia instance (mirroring admin-2fa.ts) rather than inlined into the
 * 1900-line admin.ts so the surface stays scoped and reviewable.
 *
 * Auth: same pattern as admin.ts — onBeforeHandle gates everything on an
 * admin session cookie. The .derive expose adminEmail so the audit log
 * records who added/removed each entry.
 */
// ─── Shared body schema ─────────────────────────────────
// Declared BEFORE the route registrations because Elysia evaluates the
// route options object eagerly during chain building — referencing
// ENTRY_BODY there before this declaration throws TDZ ReferenceError
// the first time the file is imported.
const ENTRY_BODY = t.Object({
  type: t.Union([t.Literal("email"), t.Literal("ip"), t.Literal("country"), t.Literal("vpn")]),
  value: t.String({ minLength: 1, maxLength: 254 }),
  note: t.Optional(t.String({ maxLength: 500 })),
});

export const adminBlocklistRoutes = new Elysia({ prefix: "/api/admin" })
  .onBeforeHandle(async ({ cookie, status }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
    if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
    return;
  })
  .derive(async ({ cookie }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    return { adminEmail: user?.email ?? "unknown" };
  })

  // ─── List entries by mode. The frontend BlockEntry interface expects
  // createdAt as an ISO string; serialize the Date here so JSON sends a
  // proper timestamp rather than an epoch ms number that the table cell
  // would render as raw digits.
  .get("/blacklist", async () => listEntries("blacklist"))
  .get("/whitelist", async () => listEntries("whitelist"))

  // ─── Add an entry. UNIQUE on (mode, type, value) prevents accidental
  // dupes — a 409 surfaces as a toast in the UI rather than the silent
  // success the previous (404'd) route delivered.
  .post(
    "/blacklist",
    async ({ body, set, adminEmail }) => addEntry("blacklist", body, set, adminEmail),
    { body: ENTRY_BODY },
  )
  .post(
    "/whitelist",
    async ({ body, set, adminEmail }) => addEntry("whitelist", body, set, adminEmail),
    { body: ENTRY_BODY },
  )

  // ─── Remove an entry. Scoped to the requested mode so a forged id
  // from the other list can never be removed via this endpoint.
  .delete("/blacklist/:id", async ({ params, set, adminEmail }) =>
    deleteEntry("blacklist", params.id, set, adminEmail),
  )
  .delete("/whitelist/:id", async ({ params, set, adminEmail }) =>
    deleteEntry("whitelist", params.id, set, adminEmail),
  );

// ─── Helpers ────────────────────────────────────────────────
async function listEntries(mode: "blacklist" | "whitelist") {
  const rows = await db
    .select()
    .from(blocklist)
    .where(eq(blocklist.mode, mode))
    .orderBy(desc(blocklist.createdAt));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    value: r.value,
    note: r.note ?? undefined,
    createdAt: (r.createdAt instanceof Date
      ? r.createdAt
      : new Date(r.createdAt as unknown as number)
    ).toISOString(),
  }));
}

async function addEntry(
  mode: "blacklist" | "whitelist",
  body: { type: "email" | "ip" | "country" | "vpn"; value: string; note?: string },
  set: { status?: number },
  adminEmail: string,
) {
  // Type-specific normalisation. Email + country are case-insensitive;
  // IPs are stored verbatim (operator might paste a v4 or v6 form).
  // Country codes are clamped to 2 chars so a stray "United States" paste
  // doesn't end up as a phantom row that never matches.
  const trimmed = body.value.trim();
  if (!trimmed) {
    set.status = 400;
    return { error: "Value is required", code: "EMPTY_VALUE" };
  }
  let normValue = trimmed;
  if (body.type === "email") {
    normValue = trimmed.toLowerCase();
  } else if (body.type === "country") {
    normValue = trimmed.toUpperCase().slice(0, 2);
    if (normValue.length !== 2) {
      set.status = 400;
      return { error: "Country must be a 2-letter ISO code", code: "BAD_COUNTRY" };
    }
  }
  const id = randomUUID();
  try {
    await db.insert(blocklist).values({
      id,
      mode,
      type: body.type,
      value: normValue,
      note: body.note?.trim() || null,
    });
  } catch {
    // UNIQUE collision is the common error; surface a 409 instead of 500.
    set.status = 409;
    return { error: "Already on the list", code: "DUPLICATE" };
  }
  await logAdminAction(
    adminEmail,
    `${mode}.add`,
    `${body.type}:${normValue}${body.note?.trim() ? ` (${body.note.trim()})` : ""}`,
  );
  return { ok: true, id };
}

async function deleteEntry(
  mode: "blacklist" | "whitelist",
  id: string,
  set: { status?: number },
  adminEmail: string,
) {
  const target = (
    await db
      .select()
      .from(blocklist)
      .where(and(eq(blocklist.id, id), eq(blocklist.mode, mode)))
  )[0];
  if (!target) {
    set.status = 404;
    return { error: "Not found", code: "NOT_FOUND" };
  }
  await db.delete(blocklist).where(eq(blocklist.id, id));
  await logAdminAction(adminEmail, `${mode}.remove`, `${target.type}:${target.value}`);
  return { ok: true };
}
