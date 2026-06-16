import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { rateLimitCheck } from "../lib/rate-limit.ts";
import { generateSecret, verifyCode } from "../lib/totp.ts";

// 6-digit TOTP space is only 1M values; without rate-limiting an attacker who
// has already compromised an admin cookie could brute force the second factor
// in seconds. 5 attempts / 15 min / user is enough headroom for clock skew
// and fat-fingered codes, ruinous for automated guessing.
const TOTP_VERIFY_MAX = 5;
const TOTP_VERIFY_WINDOW_MS = 15 * 60_000;

export const admin2faRoutes = new Elysia({ prefix: "/api/admin/2fa" })
  .onBeforeHandle(async ({ cookie, status }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
    if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
    return;
  })
  .derive(async ({ cookie }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    return { adminUser: user! };
  })
  .get("/status", async ({ adminUser }) => {
    const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
    return { enabled: u?.totpEnabled ?? false };
  })
  .get("/setup", async ({ adminUser, set }) => {
    const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
    if (!u) {
      set.status = 404;
      return { error: "Admin user not found" };
    }
    if (u.totpEnabled) {
      set.status = 400;
      return { error: "2FA is already enabled" };
    }

    // Generate fresh secret if not already set, or reuse existing setup secret
    const secret = u.totpSecret || generateSecret();
    if (!u.totpSecret) {
      await db.update(users).set({ totpSecret: secret }).where(eq(users.id, adminUser.id));
    }

    const otpauthUrl = `otpauth://totp/Nexora:${u.email}?secret=${secret}&issuer=Nexora`;
    return { secret, otpauthUrl };
  })
  .post(
    "/enable",
    async ({ adminUser, body, set }) => {
      const rl = rateLimitCheck(`totp-verify:${adminUser.id}`, TOTP_VERIFY_MAX, TOTP_VERIFY_WINDOW_MS);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
      if (!u || !u.totpSecret) {
        set.status = 400;
        return { error: "2FA setup not initiated" };
      }

      const valid = verifyCode(u.totpSecret, body.code);
      if (!valid) {
        set.status = 400;
        return { error: "Invalid verification code", code: "INVALID_CODE" };
      }

      await db.update(users).set({ totpEnabled: true }).where(eq(users.id, adminUser.id));

      await logAdminAction(adminUser.email, "2fa.enable", "Enabled 2FA TOTP");
      return { ok: true };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
    },
  )
  .post(
    "/disable",
    async ({ adminUser, body, set }) => {
      const rl = rateLimitCheck(`totp-verify:${adminUser.id}`, TOTP_VERIFY_MAX, TOTP_VERIFY_WINDOW_MS);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
      if (!u || !u.totpEnabled || !u.totpSecret) {
        set.status = 400;
        return { error: "2FA is not enabled" };
      }

      const valid = verifyCode(u.totpSecret, body.code);
      if (!valid) {
        set.status = 400;
        return { error: "Invalid verification code", code: "INVALID_CODE" };
      }

      await db
        .update(users)
        .set({ totpEnabled: false, totpSecret: null })
        .where(eq(users.id, adminUser.id));

      await logAdminAction(adminUser.email, "2fa.disable", "Disabled 2FA TOTP");
      return { ok: true };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
    },
  );
