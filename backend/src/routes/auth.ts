import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { users } from "../db/schema.ts";
import { logAdminAction, logAuthEvent } from "../lib/audit.ts";
import {
  createSession,
  destroySession,
  hashPassword,
  normalizeEmail,
  revokeOtherSessions,
  SESSION_COOKIE,
  sessionCookieOptions,
  validateSession,
  verifyLogin,
} from "../lib/auth.ts";
import { hookBus } from "../lib/plugin/hook-bus.ts";
import { verifyCode } from "../lib/totp.ts";
import {
  lockoutBump,
  lockoutCheck,
  lockoutReset,
  rateLimitCheck,
  clientIp as resolveClientIp,
} from "../lib/rate-limit.ts";

/* ───────── auth macros: requireAuth / requireAdmin (Elysia 1.4 macro v2 + resolve) ───────── */
// `resolve` runs after validation, injects a typed `user` into context, and short-circuits
// with `status(...)` when unauthenticated/unauthorized. Use as `{ requireAuth: true }` on a route.
export const authMacros = new Elysia({ name: "auth-macros" }).macro({
  requireAuth: {
    async resolve({ cookie, status }) {
      const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
      return { user };
    },
  },
  requireAdmin: {
    async resolve({ cookie, status }) {
      const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      if (!user) return status(401, { error: "Authentication required", code: "UNAUTHENTICATED" });
      if (user.role !== "admin") return status(403, { error: "Admin only", code: "FORBIDDEN" });
      return { user };
    },
  },
});

// Re-export shared resolver under the local name used throughout this file.
const clientIp = resolveClientIp;

// Per-account lockout window: 5 wrong passwords in 15 min locks out further
// attempts on that EMAIL (across all IPs) until the window rolls over. Closes
// the "rotate IPs to brute force one account" path that pure per-IP can't.
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60_000;

/* ───────── customer auth routes ───────── */
export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(authMacros)
  // Rate-limit auth mutations to 10 req/min per IP (brute-force defense)
  .onBeforeHandle(({ request, set }) => {
    const method = request.method;
    if (method === "POST") {
      const ip = clientIp(request);
      const result = rateLimitCheck(`auth:${ip}`, 10, 60_000);
      if (!result.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(result.resetMs / 1000));
        return { error: "Too many requests", code: "RATE_LIMITED", retryAfterMs: result.resetMs };
      }
    }
    return;
  })
  .post(
    "/register",
    async ({ body, cookie, set, request }) => {
      const ip = clientIp(request);
      const email = normalizeEmail(body.email);
      // Race-safe: rely on the UNIQUE index on users.email. The pre-select
      // is purely a UX shortcut for the 409 response; the INSERT below would
      // have failed anyway under a concurrent register-with-same-email race.
      const existing = await db.select().from(users).where(eq(users.email, email));
      if (existing.length > 0) {
        set.status = 409;
        void logAuthEvent(email, "register.dup", ip);
        return { error: "Email already registered", code: "EMAIL_TAKEN" };
      }
      const id = randomUUID();
      const passwordHash = await hashPassword(body.password);
      try {
        await db.insert(users).values({ id, email, passwordHash, role: "customer" });
      } catch {
        // Lost the race — DB UNIQUE rejected the dup. Surface the same 409.
        set.status = 409;
        void logAuthEvent(email, "register.dup", ip);
        return { error: "Email already registered", code: "EMAIL_TAKEN" };
      }

      // Emit hook for plugins (welcome email, CRM sync, etc.)
      hookBus.emit("user.created", { userId: id, email }).catch(() => {});

      const { token, expiresAt } = await createSession(id);
      cookie[SESSION_COOKIE].set({ value: token, ...sessionCookieOptions(new Date(expiresAt)) });
      void logAuthEvent(email, "register", ip);
      set.status = 201;
      return { id, email };
    },
    {
      body: t.Object({
        // 254 is the RFC-5321 cap; refuse anything longer up front so a
        // pathological value can't reach argon2id below.
        email: t.String({ format: "email", maxLength: 254 }),
        password: t.String({ minLength: 8, maxLength: 200 }),
      }),
    },
  )
  .post(
    "/login",
    async ({ body, cookie, set, request }) => {
      const ip = clientIp(request);
      const email = normalizeEmail(body.email);
      // Per-email lockout: a slow IP-rotating brute force is invisible to the
      // per-IP rate limit at the route layer. Track failed attempts against
      // the EMAIL itself; once the threshold is hit, every login attempt for
      // that account 429s until the window expires.
      const lockKey = `login-lock:${email}`;
      const lock = lockoutCheck(lockKey, LOGIN_LOCKOUT_THRESHOLD, LOGIN_LOCKOUT_WINDOW_MS);
      if (lock.locked) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(lock.resetMs / 1000));
        void logAuthEvent(email, "login.locked", ip);
        return {
          error: "Account temporarily locked — try again later",
          code: "ACCOUNT_LOCKED",
          retryAfterMs: lock.resetMs,
        };
      }
      const user = (await db.select().from(users).where(eq(users.email, email)))[0];
      const ok = await verifyLogin(user, body.password);
      if (!ok || !user) {
        lockoutBump(lockKey, LOGIN_LOCKOUT_WINDOW_MS);
        set.status = 401;
        void logAuthEvent(email, "login.fail", ip);
        return { error: "Invalid email or password", code: "BAD_CREDENTIALS" };
      }
      // Refuse banned users at the login boundary too — defense in depth on
      // top of validateSession's banned check.
      if (user.status === "banned") {
        set.status = 403;
        void logAuthEvent(email, "login.banned", ip);
        return { error: "Account suspended", code: "ACCOUNT_BANNED" };
      }
      // 2FA gate. If the account has TOTP enabled, password alone isn't
      // enough — caller must include `code` in the request body. Without
      // this gate, enabling 2FA in the admin UI did NOTHING at the login
      // boundary: the session cookie was minted on password-only and the
      // TOTP flag was cosmetic. Verify the 6-digit code BEFORE issuing the
      // cookie so a stolen password is useless without the second factor.
      if (user.totpEnabled && user.totpSecret) {
        const code = body.code;
        if (!code || code.length !== 6) {
          set.status = 401;
          // Don't bump lockout for "missing code" — the password was right;
          // the client just needs to re-submit with the code attached.
          return { error: "2FA code required", code: "TOTP_REQUIRED" };
        }
        const totpResult = verifyCode(user.totpSecret, code, user.lastTotpCounter);
        if (!totpResult.ok) {
          lockoutBump(lockKey, LOGIN_LOCKOUT_WINDOW_MS);
          set.status = 401;
          void logAuthEvent(email, "login.2fa_fail", ip);
          return { error: "Invalid 2FA code", code: "BAD_2FA" };
        }
        await db
          .update(users)
          .set({ lastTotpCounter: totpResult.counter })
          .where(eq(users.id, user.id));
      }
      lockoutReset(lockKey);
      const { token, expiresAt } = await createSession(user.id);
      cookie[SESSION_COOKIE].set({ value: token, ...sessionCookieOptions(new Date(expiresAt)) });
      void logAuthEvent(email, "login.ok", ip, user.role === "admin" ? "(admin)" : undefined);
      return { id: user.id, email: user.email, role: user.role };
    },
    {
      body: t.Object({
        email: t.String({ maxLength: 254 }),
        password: t.String({ maxLength: 200 }),
        code: t.Optional(t.String({ minLength: 6, maxLength: 6 })),
      }),
    },
  )
  .post("/logout", async ({ cookie, request }) => {
    const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
    // We don't know the email at this point unless we re-read the session;
    // do a non-blocking read so the audit trail still has the actor.
    if (tok) {
      validateSession(tok)
        .then((u) => {
          if (u) void logAuthEvent(u.email, "logout", clientIp(request));
        })
        .catch(() => {});
    }
    await destroySession(tok);
    cookie[SESSION_COOKIE]?.remove();
    return { ok: true };
  })
  .get("/me", async ({ cookie, set }) => {
    const user = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (!user) {
      set.status = 401;
      return { error: "Not authenticated", code: "UNAUTHENTICATED" };
    }
    return { id: user.id, email: user.email, role: user.role };
  });

/* ───────── bootstrap single admin from env ───────── */
// ADMIN_EMAIL + ADMIN_PASSWORD_HASH (an argon2id hash). If only ADMIN_PASSWORD (plaintext) is set
// in dev, we hash it on boot. Upserts a users row with role='admin' so it uses the same session path.
export async function bootstrapAdmin() {
  const email = Bun.env.ADMIN_EMAIL ? normalizeEmail(Bun.env.ADMIN_EMAIL) : null;
  if (!email) {
    return;
  }
  (globalThis as any).__nexora_admin_email = email;

  // Production refuses plaintext ADMIN_PASSWORD: a CI secret leak, container
  // image scan, or environment dump must not expose anything more than an
  // argon2id hash. Local dev is exempt so first-run setup stays trivial.
  const isProd = Bun.env.NODE_ENV === "production";
  if (isProd && !Bun.env.ADMIN_PASSWORD_HASH && Bun.env.ADMIN_PASSWORD) {
    console.error(
      "[boot] FATAL: ADMIN_PASSWORD is plaintext in production. Set ADMIN_PASSWORD_HASH to an argon2id hash and unset ADMIN_PASSWORD.",
    );
    process.exit(1);
  }

  let passwordHash = Bun.env.ADMIN_PASSWORD_HASH ?? null;
  if (!passwordHash && Bun.env.ADMIN_PASSWORD) {
    passwordHash = await hashPassword(Bun.env.ADMIN_PASSWORD);
  }
  if (!passwordHash) {
    return;
  }
  const existing = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (existing) {
    // Previously: every boot rewrote passwordHash + role from env, which
    // (a) silently reverted any in-app password rotation on next deploy,
    // (b) let anyone who could edit env elevate an arbitrary pre-existing
    // customer email to admin just by setting ADMIN_EMAIL to that address,
    // (c) ran with no audit trail and no session invalidation, so a leaked
    // post-rotation cookie could outlive the password change indefinitely.
    // Now we only ESCALATE/ROTATE under an explicit ADMIN_BOOTSTRAP_FORCE=true
    // override, and the rotation is logged + every existing session is dropped.
    const force = (Bun.env.ADMIN_BOOTSTRAP_FORCE ?? "").toLowerCase() === "true";
    if (force) {
      // Refuse to silently disable 2FA: if the existing admin has TOTP enabled,
      // a force-rotation that ignores it would let an env-editor bypass 2FA on
      // the next deploy. Operator must explicitly clear 2FA via the admin API
      // before forcing a password rotation, OR set ADMIN_BOOTSTRAP_FORCE_2FA
      // to acknowledge that recovery requires re-enrollment.
      const allow2faReset =
        (Bun.env.ADMIN_BOOTSTRAP_FORCE_2FA ?? "").toLowerCase() === "true";
      if (existing.totpEnabled && !allow2faReset) {
        console.error(
          `[boot] FATAL: ADMIN_BOOTSTRAP_FORCE=true but ${email} has 2FA enabled. ` +
            `Set ADMIN_BOOTSTRAP_FORCE_2FA=true to acknowledge that 2FA will be cleared and require re-enrollment after this boot.`,
        );
        process.exit(1);
      }
      await db
        .update(users)
        .set({
          passwordHash,
          role: "admin",
          // Clear 2FA when explicitly acknowledged — a forced rotation should
          // never leave a stale TOTP secret bound to the previous credential.
          ...(existing.totpEnabled && allow2faReset
            ? {
                totpEnabled: false,
                totpSecret: null,
                totpBackupCodes: null,
                lastTotpCounter: -1,
              }
            : {}),
        })
        .where(eq(users.id, existing.id));

      // Drop every live session for this user so a cookie minted before the
      // rotation can't outlive it. revokeOtherSessions(userId, undefined)
      // clears them all including any concurrent flows.
      const revoked = await revokeOtherSessions(existing.id, undefined);

      // Audit trail: this is one of the most security-sensitive operations
      // the system performs (silent admin password rotation), so log it
      // even though it ran under the operator's environment, not a request.
      await logAdminAction(
        email,
        "admin.bootstrap_force",
        `Forced password rotation${
          existing.totpEnabled && allow2faReset ? " + 2FA cleared" : ""
        } (revoked ${revoked} session${revoked === 1 ? "" : "s"})`,
      );
      console.warn(
        `[boot] ADMIN_BOOTSTRAP_FORCE: rotated ${email} (revoked ${revoked} session${revoked === 1 ? "" : "s"}${
          existing.totpEnabled && allow2faReset ? ", cleared 2FA" : ""
        })`,
      );
    } else if (existing.role !== "admin") {
      console.warn(
        `[boot] ADMIN_EMAIL matches existing non-admin user ${email}; refusing to escalate without ADMIN_BOOTSTRAP_FORCE=true`,
      );
    }
    // No-op when existing user is already admin and no force requested —
    // this is the intended path for restarts.
  } else {
    await db.insert(users).values({ id: randomUUID(), email, passwordHash, role: "admin" });
  }
}
