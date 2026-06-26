import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import { logAdminAction } from "../lib/audit.ts";
import { revokeOtherSessions, SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { degradedGate } from "../lib/integrity-state.ts";
import { rateLimitCheck } from "../lib/rate-limit.ts";
import {
  generateBackupCodes,
  generateSecret,
  hashBackupCodes,
  verifyAndConsumeBackupCode,
  verifyCode,
} from "../lib/totp.ts";

// 6-digit TOTP space is only 1M values; without rate-limiting an attacker who
// has already compromised an admin cookie could brute force the second factor
// in seconds. 5 attempts / 15 min / user is enough headroom for clock skew
// and fat-fingered codes, ruinous for automated guessing.
const TOTP_VERIFY_MAX = 5;
const TOTP_VERIFY_WINDOW_MS = 15 * 60_000;

/**
 * Ephemeral 2FA-setup candidate store.
 *
 * The previous flow persisted `users.totp_secret` immediately on /setup, so
 * a user who hit /setup but never confirmed the code (or whose admin cookie
 * was compromised between /setup and /enable) would leave a usable secret
 * in the database. We now keep candidate secrets and backup codes in a
 * short-lived in-memory map keyed by userId; only /enable, after a valid
 * TOTP code is matched against the candidate, actually persists anything
 * to the users row.
 *
 * TTL is 10 minutes — long enough for an admin to scan the QR code and
 * type the first code from their authenticator, short enough that a
 * forgotten setup can't be hijacked.
 */
type Candidate = {
  secret: string;
  backupCodesPlain: string[]; // returned ONCE on /setup; never persisted in plaintext
  backupCodesHashed: string[]; // what we'll store on /enable success
  expiresAt: number;
};
const candidates = new Map<string, Candidate>();
const CANDIDATE_TTL_MS = 10 * 60_000;

function pruneExpiredCandidates(): void {
  const now = Date.now();
  for (const [k, c] of candidates) {
    if (c.expiresAt < now) candidates.delete(k);
  }
}

export const admin2faRoutes = new Elysia({ prefix: "/api/admin/2fa" })
  .onBeforeHandle(async ({ cookie, status }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
    if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
    return;
  })
  .onBeforeHandle(degradedGate)
  .derive(async ({ cookie }) => {
    const token = cookie[SESSION_COOKIE]?.value as string | undefined;
    const user = await validateSession(token);
    return { adminUser: user!, currentToken: token };
  })
  .get("/status", async ({ adminUser }) => {
    const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
    return { enabled: u?.totpEnabled ?? false };
  })
  .get("/setup", async ({ adminUser, set }) => {
    pruneExpiredCandidates();
    const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
    if (!u) {
      set.status = 404;
      return { error: "Admin user not found", code: "ADMIN_NOT_FOUND" };
    }
    if (u.totpEnabled) {
      set.status = 400;
      return { error: "2FA is already enabled", code: "TOTP_ALREADY_ENABLED" };
    }

    // Always rotate: a fresh /setup call invalidates any prior candidate so
    // an admin who started enrollment, walked away, and came back doesn't
    // accidentally enable a secret an attacker could have observed.
    const secret = generateSecret();
    const backupCodesPlain = generateBackupCodes();
    const backupCodesHashed = hashBackupCodes(backupCodesPlain);
    candidates.set(adminUser.id, {
      secret,
      backupCodesPlain,
      backupCodesHashed,
      expiresAt: Date.now() + CANDIDATE_TTL_MS,
    });

    const otpauthUrl = `otpauth://totp/Nexora:${u.email}?secret=${secret}&issuer=Nexora`;
    // Plaintext backup codes are returned ONCE here. The client is expected
    // to display them and warn the admin to copy them — the server will only
    // ever store hashes once /enable lands.
    return { secret, otpauthUrl, backupCodes: backupCodesPlain };
  })
  .post(
    "/enable",
    async ({ adminUser, body, set, currentToken }) => {
      const rl = rateLimitCheck(
        `totp-verify:${adminUser.id}`,
        TOTP_VERIFY_MAX,
        TOTP_VERIFY_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      pruneExpiredCandidates();
      const candidate = candidates.get(adminUser.id);
      if (!candidate) {
        set.status = 400;
        return { error: "2FA setup not initiated or expired", code: "NO_CANDIDATE" };
      }

      const result = verifyCode(candidate.secret, body.code, -1);
      if (!result.ok) {
        set.status = 400;
        return { error: "Invalid verification code", code: "INVALID_CODE" };
      }

      // Persist secret (encrypted by the encryptedText custom column type),
      // toggle the flag, seed lastTotpCounter with the just-matched step
      // so the same code can't be replayed even before the next 30s window.
      await db
        .update(users)
        .set({
          totpSecret: candidate.secret,
          totpEnabled: true,
          lastTotpCounter: result.counter,
          totpBackupCodes: JSON.stringify(candidate.backupCodesHashed),
        })
        .where(eq(users.id, adminUser.id));

      candidates.delete(adminUser.id);

      // Evict any session minted before 2FA was enabled — a stolen cookie
      // captured during the pre-2FA window must not survive enrollment.
      // Keep the current session so the admin doesn't log themselves out.
      const revoked = await revokeOtherSessions(adminUser.id, currentToken);

      await logAdminAction(
        adminUser.email,
        "2fa.enable",
        `Enabled 2FA TOTP (revoked ${revoked} other session${revoked === 1 ? "" : "s"})`,
      );
      return { ok: true, revokedSessions: revoked };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
    },
  )
  .post(
    "/disable",
    async ({ adminUser, body, set, currentToken }) => {
      const rl = rateLimitCheck(
        `totp-verify:${adminUser.id}`,
        TOTP_VERIFY_MAX,
        TOTP_VERIFY_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
      if (!u || !u.totpEnabled || !u.totpSecret) {
        set.status = 400;
        return { error: "2FA is not enabled", code: "TOTP_NOT_ENABLED" };
      }

      const result = verifyCode(u.totpSecret, body.code, u.lastTotpCounter);
      if (!result.ok) {
        set.status = 400;
        return { error: "Invalid verification code", code: "INVALID_CODE" };
      }

      await db
        .update(users)
        .set({
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
          lastTotpCounter: result.counter,
        })
        .where(eq(users.id, adminUser.id));

      // Evict every other session: disabling 2FA weakens the auth state, so
      // any cookie that exists alongside the actor's must be re-issued via
      // a fresh login flow.
      const revoked = await revokeOtherSessions(adminUser.id, currentToken);

      await logAdminAction(
        adminUser.email,
        "2fa.disable",
        `Disabled 2FA TOTP (revoked ${revoked} other session${revoked === 1 ? "" : "s"})`,
      );
      return { ok: true, revokedSessions: revoked };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
    },
  )
  /**
   * Recovery: consume a one-shot backup code, force totp_enabled=false so
   * the admin must re-enroll a fresh authenticator app. Rate-limited the
   * same way as TOTP verification — backup codes are 10 alphanumeric chars
   * (~50 bits), well out of online-brute-force range, but a tight bucket
   * keeps the window narrow regardless.
   */
  .post(
    "/recover",
    async ({ adminUser, body, set, currentToken }) => {
      const rl = rateLimitCheck(
        `totp-verify:${adminUser.id}`,
        TOTP_VERIFY_MAX,
        TOTP_VERIFY_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const u = (await db.select().from(users).where(eq(users.id, adminUser.id)))[0];
      if (!u || !u.totpEnabled || !u.totpBackupCodes) {
        set.status = 400;
        return { error: "2FA is not enabled or no backup codes enrolled", code: "NO_BACKUP" };
      }
      let hashes: string[] = [];
      try {
        const parsed = JSON.parse(u.totpBackupCodes);
        if (Array.isArray(parsed))
          hashes = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        // Corrupt store — refuse rather than silently accepting any code.
        set.status = 500;
        return { error: "Backup code store unreadable", code: "BACKUP_CORRUPT" };
      }
      const res = verifyAndConsumeBackupCode(body.code, hashes);
      if (!res.ok) {
        set.status = 400;
        return { error: "Invalid backup code", code: "INVALID_BACKUP" };
      }

      // Force re-enrollment: clear secret + flag so the admin has to walk
      // through /setup → /enable again with a fresh QR. The remaining
      // (unused) backup codes are dropped because the next /enable will
      // mint a new set anyway.
      await db
        .update(users)
        .set({
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
          lastTotpCounter: -1,
        })
        .where(eq(users.id, adminUser.id));

      // Most dangerous flow: a backup code can fully bypass the second
      // factor, so we must purge every other live session for this admin
      // to evict any cookie that was operating with the (now-revoked) 2FA
      // assumption. The current cookie survives so the actor can re-enroll.
      const revoked = await revokeOtherSessions(adminUser.id, currentToken);

      await logAdminAction(
        adminUser.email,
        "2fa.recover",
        `Used backup code; ${res.remaining.length} remaining (disabled, must re-enroll, revoked ${revoked} session${revoked === 1 ? "" : "s"})`,
      );
      return { ok: true, remaining: res.remaining.length, revokedSessions: revoked };
    },
    {
      body: t.Object({
        // Allow some flexibility (spaces / dashes); the verifier normalizes.
        code: t.String({ minLength: 8, maxLength: 32 }),
      }),
    },
  );
