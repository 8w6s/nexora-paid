import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import { logAuthEvent } from "../lib/audit.ts";
import { revokeOtherSessions, SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import {
  rateLimitCheck,
  clientIp as resolveClientIp,
} from "../lib/rate-limit.ts";
import {
  generateBackupCodes,
  generateSecret,
  hashBackupCodes,
  verifyAndConsumeBackupCode,
  verifyCode,
} from "../lib/totp.ts";

/**
 * Customer-facing 2FA enrollment surface. Mirrors admin-2fa.ts pattern
 * (candidate map + verify-then-persist + revoke other sessions on
 * enable/disable/recover) but mounted under /api/auth/2fa with a
 * customer role gate.
 *
 * The login flow in auth.ts already enforces TOTP universally — any
 * users row with totpEnabled=true requires the second factor regardless
 * of role — so wiring the customer enrollment endpoints is the only
 * piece needed to ship this.
 */

// 6-digit TOTP space is only 1M values. Without rate-limiting an
// attacker who has already compromised a customer cookie could brute-
// force the second factor in seconds. 5 attempts / 15 min / user gives
// headroom for clock skew + fat-fingered codes, ruinous for automation.
const TOTP_VERIFY_MAX = 5;
const TOTP_VERIFY_WINDOW_MS = 15 * 60_000;

/**
 * Ephemeral 2FA-setup candidate store. Same pattern as admin-2fa.ts —
 * the secret is held in-memory for 10 minutes after /setup; only when
 * the customer confirms the first 6-digit code via /enable do we
 * persist anything to the users row. This blocks the "secret is in DB
 * the moment /setup is hit" failure mode where a half-finished
 * enrollment leaves a usable secret behind.
 */
type Candidate = {
  secret: string;
  backupCodesPlain: string[];
  backupCodesHashed: string[];
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

export const customer2faRoutes = new Elysia({ prefix: "/api/auth/2fa" })
  .onBeforeHandle(async ({ cookie, status }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
    // Customer-only route. Admin 2FA lives under /api/admin/2fa with
    // its own session cap + tone bucket — funnelling admin enrollment
    // through this surface would weaken the admin path.
    if (user.role !== "customer") {
      return status(403, { error: "Customer-only endpoint", code: "WRONG_ROLE" });
    }
    return;
  })
  .derive(async ({ cookie }) => {
    const token = cookie[SESSION_COOKIE]?.value as string | undefined;
    const user = await validateSession(token);
    return { customerUser: user!, currentToken: token };
  })

  .get("/status", async ({ customerUser }) => {
    const u = (await db.select().from(users).where(eq(users.id, customerUser.id)))[0];
    return { enabled: u?.totpEnabled ?? false };
  })

  .get("/setup", async ({ customerUser, set }) => {
    pruneExpiredCandidates();
    const u = (await db.select().from(users).where(eq(users.id, customerUser.id)))[0];
    if (!u) {
      set.status = 404;
      return { error: "User not found" };
    }
    if (u.totpEnabled) {
      set.status = 400;
      return { error: "2FA is already enabled" };
    }

    // Always rotate: a fresh /setup invalidates any prior candidate so
    // a customer who started enrollment, walked away, and came back
    // doesn't accidentally enable a secret an attacker could have
    // observed during the gap.
    const secret = generateSecret();
    const backupCodesPlain = generateBackupCodes();
    const backupCodesHashed = hashBackupCodes(backupCodesPlain);
    candidates.set(customerUser.id, {
      secret,
      backupCodesPlain,
      backupCodesHashed,
      expiresAt: Date.now() + CANDIDATE_TTL_MS,
    });

    const otpauthUrl = `otpauth://totp/Nexora:${u.email}?secret=${secret}&issuer=Nexora`;
    return { secret, otpauthUrl, backupCodes: backupCodesPlain };
  })

  .post(
    "/enable",
    async ({ customerUser, body, set, currentToken, request }) => {
      const ip = resolveClientIp(request);
      const rl = rateLimitCheck(
        `customer-totp-verify:${customerUser.id}`,
        TOTP_VERIFY_MAX,
        TOTP_VERIFY_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      pruneExpiredCandidates();
      const candidate = candidates.get(customerUser.id);
      if (!candidate) {
        set.status = 400;
        return { error: "2FA setup not initiated or expired", code: "NO_CANDIDATE" };
      }

      const result = verifyCode(candidate.secret, body.code, -1);
      if (!result.ok) {
        void logAuthEvent(customerUser.email, "customer_2fa.bad_code", ip);
        set.status = 400;
        return { error: "Invalid verification code", code: "INVALID_CODE" };
      }

      // Persist secret (encrypted via the encryptedText custom column),
      // toggle the flag, seed lastTotpCounter with the just-matched
      // step so the same code can't be replayed before the next 30s.
      await db
        .update(users)
        .set({
          totpSecret: candidate.secret,
          totpEnabled: true,
          lastTotpCounter: result.counter,
          totpBackupCodes: JSON.stringify(candidate.backupCodesHashed),
        })
        .where(eq(users.id, customerUser.id));

      candidates.delete(customerUser.id);

      // Evict every other session — a stolen cookie captured during
      // the pre-2FA window must not survive enrollment. Actor's own
      // session survives so they don't bounce mid-flow.
      const revoked = await revokeOtherSessions(customerUser.id, currentToken);

      void logAuthEvent(
        customerUser.email,
        "customer_2fa.enable",
        ip,
        revoked > 0 ? `(revoked ${revoked} session${revoked === 1 ? "" : "s"})` : undefined,
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
    async ({ customerUser, body, set, currentToken, request }) => {
      const ip = resolveClientIp(request);
      const rl = rateLimitCheck(
        `customer-totp-verify:${customerUser.id}`,
        TOTP_VERIFY_MAX,
        TOTP_VERIFY_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const u = (await db.select().from(users).where(eq(users.id, customerUser.id)))[0];
      if (!u || !u.totpEnabled || !u.totpSecret) {
        set.status = 400;
        return { error: "2FA is not enabled" };
      }

      const result = verifyCode(u.totpSecret, body.code, u.lastTotpCounter);
      if (!result.ok) {
        void logAuthEvent(customerUser.email, "customer_2fa.bad_code", ip);
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
        .where(eq(users.id, customerUser.id));

      // Evict every other session: disabling 2FA weakens the auth
      // state, so any cookie operating alongside the actor's must be
      // re-issued via a fresh login flow.
      const revoked = await revokeOtherSessions(customerUser.id, currentToken);

      void logAuthEvent(
        customerUser.email,
        "customer_2fa.disable",
        ip,
        revoked > 0 ? `(revoked ${revoked} session${revoked === 1 ? "" : "s"})` : undefined,
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
   * Backup-code recovery: consume one one-shot code, force
   * totpEnabled=false so the customer must re-enrol with a fresh
   * authenticator. Same rate-limit as TOTP verification — backup
   * codes are 10 alphanum chars (~50 bits, well out of online-brute-
   * force range) but a tight bucket keeps the window narrow anyway.
   */
  .post(
    "/recover",
    async ({ customerUser, body, set, currentToken, request }) => {
      const ip = resolveClientIp(request);
      const rl = rateLimitCheck(
        `customer-totp-verify:${customerUser.id}`,
        TOTP_VERIFY_MAX,
        TOTP_VERIFY_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }
      const u = (await db.select().from(users).where(eq(users.id, customerUser.id)))[0];
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
        void logAuthEvent(customerUser.email, "customer_2fa.bad_backup", ip);
        set.status = 400;
        return { error: "Invalid backup code", code: "INVALID_BACKUP" };
      }

      // Force re-enrollment: clear secret + flag so the customer has
      // to walk through /setup -> /enable again with a fresh QR. The
      // remaining (unused) backup codes are dropped because the next
      // /enable will mint a new set anyway.
      await db
        .update(users)
        .set({
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
          lastTotpCounter: -1,
        })
        .where(eq(users.id, customerUser.id));

      // Most dangerous flow: a backup code can fully bypass the
      // second factor, so we must purge every other live session
      // for this customer to evict any cookie that was operating with
      // the (now-revoked) 2FA assumption. Current cookie survives so
      // the actor can re-enrol.
      const revoked = await revokeOtherSessions(customerUser.id, currentToken);

      void logAuthEvent(
        customerUser.email,
        "customer_2fa.recover",
        ip,
        `(${res.remaining.length} codes left, revoked ${revoked} session${revoked === 1 ? "" : "s"})`,
      );
      return { ok: true, remaining: res.remaining.length, revokedSessions: revoked };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 8, maxLength: 32 }),
      }),
    },
  );