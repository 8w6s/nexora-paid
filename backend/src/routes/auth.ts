import { createHash, randomBytes, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/connection.ts";
import { passwordResets, sessions, users } from "../db/schema.ts";
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
  verifyPassword,
} from "../lib/auth.ts";
import { EmailService } from "../lib/email.ts";
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

      const { token, expiresAt } = await createSession(id, "customer", { ip, userAgent: request.headers.get("user-agent") });
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
      // Pass role so admin sessions get the 8h hard cap rather than the
      // 30d customer ceiling. SOC2 / ISO 27001 baseline for admin re-auth.
      const { token, expiresAt } = await createSession(user.id, user.role, { ip, userAgent: request.headers.get("user-agent") });
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
  })

  /* ───────── password reset (customer-only, two-step) ───────── */
  // Step 1: /forgot — accept any email, ALWAYS return ok=true so an attacker
  // can't enumerate registered emails by timing or response shape. If the
  // email matches a real user, mint a single-use token and email a reset
  // link. Per-email + per-IP rate limits sit on top of the per-route 10/min
  // already enforced by the /api/auth umbrella.
  //
  // Step 2: /reset — exchange a token + new password for a session. We do
  // sha256(token) lookup, verify not-expired AND not-used, atomically flip
  // usedAt + write the new password hash inside a transaction, and then
  // revoke every other session for the user so a stolen pre-reset cookie
  // can't outlive the rotation.
  .post(
    "/forgot",
    async ({ body, request }) => {
      const email = normalizeEmail(body.email);
      const ip = clientIp(request);

      // Per-email floor: 3 tokens / hour / email caps mailbox flooding even
      // if the route-level 10/min/IP is bypassed by IP rotation. We bump
      // the lockout-style counter on every accepted POST regardless of
      // whether the email exists, so a probe-spammer hits the wall too.
      const FORGOT_PER_EMAIL_MAX = 3;
      const FORGOT_PER_EMAIL_WINDOW_MS = 60 * 60_000;
      const emailKey = `forgot-email:${email}`;
      const emailLock = lockoutCheck(emailKey, FORGOT_PER_EMAIL_MAX, FORGOT_PER_EMAIL_WINDOW_MS);
      if (emailLock.locked) {
        // Still return ok=true to preserve enumeration resistance — but
        // skip the actual mint/send work. The client sees the same UX as
        // a successful request.
        void logAuthEvent(email, "forgot.throttled", ip);
        return { ok: true };
      }
      lockoutBump(emailKey, FORGOT_PER_EMAIL_WINDOW_MS);

      const user = (await db.select().from(users).where(eq(users.email, email)))[0];

      // Always-succeed shape: don't reveal whether `email` is registered.
      // Branch on user only AFTER the response shape is fixed.
      if (!user || user.status === "banned" || user.role !== "customer") {
        // Burn ~equivalent time so a registered-vs-not check can't be made
        // by measuring the response latency. argon2id verify against the
        // dummy hash is the closest analog to the work that the registered
        // path would do.
        await verifyLogin(undefined, "x".repeat(8));
        void logAuthEvent(email, "forgot.miss", ip);
        return { ok: true };
      }

      // Best-effort sweep of expired/used tokens for THIS user before
      // minting a new one. Keps the password_resets table from accumulating
      // dead rows on a chatty user. We don't hard-fail on a sweep error —
      // the new token write is the only thing that matters here.
      try {
        const stale = await db
          .select()
          .from(passwordResets)
          .where(eq(passwordResets.userId, user.id));
        const now = Date.now();
        for (const row of stale) {
          if (
            (row.usedAt !== null && row.usedAt !== undefined) ||
            new Date(row.expiresAt).getTime() < now
          ) {
            await db.delete(passwordResets).where(eq(passwordResets.token, row.token));
          }
        }
      } catch {
        // non-fatal
      }

      // Token shape mirrors the session cookie: 32 random bytes hex (256
      // bit). The raw token is emailed; only sha256(token) hits the DB.
      const rawToken = randomBytes(32).toString("hex");
      const hashed = createHash("sha256").update(rawToken).digest("hex");
      const TTL_MIN = 60;
      const expiresAt = new Date(Date.now() + TTL_MIN * 60_000);
      await db.insert(passwordResets).values({
        token: hashed,
        userId: user.id,
        expiresAt,
        ipAddress: ip,
      });

      const origin = Bun.env.PUBLIC_ORIGIN ?? "http://localhost:4321";
      const resetUrl = `${origin}/reset?token=${rawToken}`;
      // Email is best-effort. If the provider is off / unconfigured we
      // still return ok=true — the operator can read the audit log to find
      // the URL during local dev. Don't await blocking response on the
      // network call.
      EmailService.passwordReset(user.email, resetUrl, TTL_MIN)
        .then((r) => {
          if ("error" in r) {
            console.warn(`[email] password-reset send failed for ${user.email}: ${r.error}`);
          } else if ("skipped" in r) {
            // Dev / unconfigured email provider — surface the URL on the
            // server console so a local operator can still finish the flow.
            console.warn(`[forgot] email disabled — reset URL: ${resetUrl}`);
          }
        })
        .catch(() => {});

      void logAuthEvent(email, "forgot.sent", ip);
      return { ok: true };
    },
    {
      body: t.Object({
        email: t.String({ format: "email", maxLength: 254 }),
      }),
    },
  )
  .post(
    "/reset",
    async ({ body, cookie, set, request }) => {
      const ip = clientIp(request);
      // Rate-limit guess attempts per-IP separately from the umbrella —
      // a stolen but partial token shouldn't be brute-forceable even from
      // one IP. 8 attempts / 15 min is room for a fat-fingered paste with
      // no headroom for automation.
      const RESET_PER_IP_MAX = 8;
      const RESET_PER_IP_WINDOW_MS = 15 * 60_000;
      const rl = rateLimitCheck(`reset-attempt:${ip}`, RESET_PER_IP_MAX, RESET_PER_IP_WINDOW_MS);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many reset attempts", code: "RATE_LIMITED", retryAfterMs: rl.resetMs };
      }

      // Validate token shape up-front so we don't hash/lookup garbage. The
      // raw token is 64 lowercase hex chars (32 bytes).
      if (!/^[0-9a-f]{64}$/i.test(body.token)) {
        void logAuthEvent("(unknown)", "reset.bad_token_shape", ip);
        set.status = 400;
        return { error: "Invalid or expired reset link", code: "BAD_TOKEN" };
      }

      const hashed = createHash("sha256").update(body.token).digest("hex");
      const row = (
        await db.select().from(passwordResets).where(eq(passwordResets.token, hashed))
      )[0];

      if (!row) {
        void logAuthEvent("(unknown)", "reset.miss", ip);
        set.status = 400;
        return { error: "Invalid or expired reset link", code: "BAD_TOKEN" };
      }
      if (row.usedAt) {
        void logAuthEvent("(unknown)", "reset.replay", ip);
        set.status = 400;
        return { error: "Invalid or expired reset link", code: "BAD_TOKEN" };
      }
      if (new Date(row.expiresAt).getTime() < Date.now()) {
        // Best-effort GC of the expired row — keeps the table tidy.
        await db.delete(passwordResets).where(eq(passwordResets.token, hashed)).catch(() => {});
        void logAuthEvent("(unknown)", "reset.expired", ip);
        set.status = 400;
        return { error: "Invalid or expired reset link", code: "BAD_TOKEN" };
      }

      const user = (await db.select().from(users).where(eq(users.id, row.userId)))[0];
      if (!user || user.status === "banned" || user.role !== "customer") {
        // Edge: user was deleted or banned between mint + redeem. Burn the
        // token regardless so it can't be re-tried.
        await db.delete(passwordResets).where(eq(passwordResets.token, hashed)).catch(() => {});
        void logAuthEvent(user?.email ?? "(unknown)", "reset.user_gone", ip);
        set.status = 400;
        return { error: "Invalid or expired reset link", code: "BAD_TOKEN" };
      }

      const newHash = await hashPassword(body.password);

      // Atomic: rotate the password AND mark the token used in one tx so a
      // crash mid-flow can't leave a usable token next to the new password.
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({ passwordHash: newHash })
            .where(eq(users.id, user.id));
          await tx
            .update(passwordResets)
            .set({ usedAt: new Date() })
            .where(eq(passwordResets.token, hashed));
        });
      } catch {
        set.status = 500;
        return { error: "Reset failed, try again", code: "RESET_FAILED" };
      }

      // Sweep every other live session for this user — a stolen cookie
      // captured before the rotation must not survive it. The actor's own
      // session (currentToken=undefined) is included since reset is a
      // re-auth flow: we'll mint a fresh session right after.
      const revoked = await revokeOtherSessions(user.id, undefined);

      // Auto-login the user on the rotated credential. Same path as login.
      const { token, expiresAt } = await createSession(user.id, user.role, {
        ip,
        userAgent: request.headers.get("user-agent"),
      });
      cookie[SESSION_COOKIE].set({
        value: token,
        ...sessionCookieOptions(new Date(expiresAt)),
      });

      void logAuthEvent(
        user.email,
        "reset.ok",
        ip,
        revoked > 0 ? `(revoked ${revoked} session${revoked === 1 ? "" : "s"})` : undefined,
      );
      return { ok: true, id: user.id, email: user.email, role: user.role };
    },
    {
      body: t.Object({
        token: t.String({ minLength: 64, maxLength: 64 }),
        password: t.String({ minLength: 8, maxLength: 200 }),
      }),
    },
  )

  /* ───────── self-service password change (logged-in customer) ───────── */
  // Counterpart of the /forgot flow for users who DO know their current
  // password but want to rotate it from the /account page. Sellauth's user
  // profile has the same form ("Current password / New password / Confirm").
  // Without this, a customer who's logged in but worried about a shoulder-surf
  // has to log out + go through the email round-trip — and if the operator
  // hasn't configured an email provider, they're stuck.
  //
  // - Requires the current password to be correct so a stolen cookie can't
  //   silently lock the legitimate owner out by rotating to an attacker-known
  //   value (the attacker would still need the current password to do so).
  // - Refuses identical new password so audit logs reflect actual rotations.
  // - revokeOtherSessions(userId, currentToken) on success — every cookie
  //   minted before the rotation dies; the actor's own session survives so
  //   they don't have to immediately log back in.
  // - Per-user rate-limit (lighter than /reset because the actor has already
  //   passed auth) — 5 attempts / 15 min keeps a hijacker from grinding the
  //   current-password check.
  .post(
    "/change-password",
    async ({ body, cookie, request, set }) => {
      const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
      const sessionUser = await validateSession(tok);
      if (!sessionUser) {
        set.status = 401;
        return { error: "Authentication required", code: "UNAUTHENTICATED" };
      }
      // Self-service rotation is for customers; admins use the dedicated
      // AdminTeam rotation card which already revokes 2FA-bypassing
      // bootstrap edge cases. Funnelling admin rotations through this
      // simpler flow would weaken that surface, so refuse here.
      if (sessionUser.role !== "customer") {
        set.status = 403;
        return { error: "Use the admin password rotation card", code: "WRONG_ROLE" };
      }

      const ip = clientIp(request);
      const CHANGE_RATE_MAX = 5;
      const CHANGE_RATE_WINDOW_MS = 15 * 60_000;
      const rl = rateLimitCheck(
        `change-password:${sessionUser.id}`,
        CHANGE_RATE_MAX,
        CHANGE_RATE_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return {
          error: "Too many attempts, slow down",
          code: "RATE_LIMITED",
          retryAfterMs: rl.resetMs,
        };
      }

      if (body.currentPassword === body.newPassword) {
        set.status = 400;
        return {
          error: "New password must differ from current password",
          code: "SAME_PASSWORD",
        };
      }

      const dbUser = (await db.select().from(users).where(eq(users.id, sessionUser.id)))[0];
      if (!dbUser) {
        // Edge: session valid, user row gone (cascade race). Treat as an
        // auth failure so the cookie clears on next /me poll.
        set.status = 401;
        return { error: "Authentication required", code: "UNAUTHENTICATED" };
      }

      const ok = await verifyPassword(body.currentPassword, dbUser.passwordHash);
      if (!ok) {
        void logAuthEvent(dbUser.email, "change_password.bad_current", ip);
        set.status = 401;
        return { error: "Current password is incorrect", code: "BAD_CURRENT" };
      }

      const newHash = await hashPassword(body.newPassword);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, dbUser.id));

      // Sweep every other session — a stolen cookie issued before the
      // rotation must die. Actor keps their own session so they don't
      // have to log back in mid-flow.
      const revoked = await revokeOtherSessions(dbUser.id, tok);

      void logAuthEvent(
        dbUser.email,
        "change_password.ok",
        ip,
        revoked > 0 ? `(revoked ${revoked} session${revoked === 1 ? "" : "s"})` : undefined,
      );
      return { ok: true, revokedSessions: revoked };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1, maxLength: 200 }),
        newPassword: t.String({ minLength: 8, maxLength: 200 }),
      }),
    },
  )

  /* ───────── self-service email change (logged-in customer) ───────── */
  // The email column is the customer's primary identifier (it's how they
  // log in, where order receipts go, where the password-reset link lands).
  // Without a self-service rotation a typo at register, a typoed re-bind,
  // or simply moving providers locks the customer out of their own /orders
  // permanently. Sellauth's profile General form has the same field —
  // they accept current password to confirm and update in place. Mirror.
  //
  // Hardening:
  //  - currentPassword must verify against the stored argon2id so a
  //    stolen cookie alone can't change the address (which would lock
  //    out the legitimate owner via the password-reset email landing
  //    in the attacker's mailbox).
  //  - newEmail must differ; UNIQUE constraint on users.email surfaces
  //    as 409 EMAIL_TAKEN so we don't 500.
  //  - revokeOtherSessions on success — every cookie minted under the
  //    old email is invalidated.
  //  - Best-effort notify to the OLD address (lazy fire-and-forget so
  //    the response isn't blocked) so a legitimate owner who didn't
  //    request the change has a paper trail to recover from.
  //  - Per-user rate-limit shared with /change-password's bucket so
  //    an attacker can't grind currentPassword via the email path
  //    after exhausting the password path.
  .post(
    "/change-email",
    async ({ body, cookie, request, set }) => {
      const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
      const sessionUser = await validateSession(tok);
      if (!sessionUser) {
        set.status = 401;
        return { error: "Authentication required", code: "UNAUTHENTICATED" };
      }
      if (sessionUser.role !== "customer") {
        set.status = 403;
        return { error: "Admin email change not supported here", code: "WRONG_ROLE" };
      }

      const ip = clientIp(request);
      const CHANGE_RATE_MAX = 5;
      const CHANGE_RATE_WINDOW_MS = 15 * 60_000;
      // Share the bucket with /change-password — both verify currentPassword
      // and a hijacker cycling between the two would otherwise get 2× the
      // attempts before hitting the wall.
      const rl = rateLimitCheck(
        `change-password:${sessionUser.id}`,
        CHANGE_RATE_MAX,
        CHANGE_RATE_WINDOW_MS,
      );
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return {
          error: "Too many attempts, slow down",
          code: "RATE_LIMITED",
          retryAfterMs: rl.resetMs,
        };
      }

      const newEmail = normalizeEmail(body.newEmail);
      const oldEmail = sessionUser.email;
      if (newEmail === oldEmail) {
        void logAuthEvent(oldEmail, "change_email.same", ip);
        set.status = 400;
        return { error: "New email must differ from current", code: "SAME_EMAIL" };
      }

      const dbUser = (await db.select().from(users).where(eq(users.id, sessionUser.id)))[0];
      if (!dbUser) {
        set.status = 401;
        return { error: "Authentication required", code: "UNAUTHENTICATED" };
      }

      const ok = await verifyPassword(body.currentPassword, dbUser.passwordHash);
      if (!ok) {
        void logAuthEvent(oldEmail, "change_email.bad_current", ip);
        set.status = 401;
        return { error: "Current password is incorrect", code: "BAD_CURRENT" };
      }

      // Race-safe: rely on the UNIQUE index on users.email. Pre-select
      // is a UX shortcut; the UPDATE below would have failed the same
      // way on collision, this just lets us return 409 cleanly.
      const taken = (await db.select().from(users).where(eq(users.email, newEmail)))[0];
      if (taken && taken.id !== dbUser.id) {
        void logAuthEvent(oldEmail, "change_email.taken", ip, `(attempted ${newEmail})`);
        set.status = 409;
        return { error: "That email is already in use", code: "EMAIL_TAKEN" };
      }

      try {
        await db.update(users).set({ email: newEmail }).where(eq(users.id, dbUser.id));
      } catch {
        // Lost the UNIQUE race or some other constraint failure.
        set.status = 409;
        return { error: "That email is already in use", code: "EMAIL_TAKEN" };
      }

      // Sweep every other session — old cookies that authenticated under
      // the previous email reference are gone. Actor's current session
      // survives so they don't bounce mid-flow.
      const revoked = await revokeOtherSessions(dbUser.id, tok);

      // Best-effort notify to the OLD address. Fire-and-forget so the
      // response isn't blocked on the email provider; if the provider is
      // unconfigured the send returns {skipped:true} and we don't care.
      EmailService.emailChangedNotice(oldEmail, newEmail)
        .then((r) => {
          if ("error" in r) {
            console.warn(`[email] change-email notice to ${oldEmail} failed: ${r.error}`);
          }
        })
        .catch(() => {});

      void logAuthEvent(
        oldEmail,
        "change_email.ok",
        ip,
        `→ ${newEmail}${revoked > 0 ? ` (revoked ${revoked} session${revoked === 1 ? "" : "s"})` : ""}`,
      );
      return { ok: true, email: newEmail, revokedSessions: revoked };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1, maxLength: 200 }),
        newEmail: t.String({ format: "email", maxLength: 254 }),
      }),
    },
  )

  /* ───────── customer device list + per-row revoke ────────
   * Counterpart of the AdminTeam sessions card for customer accounts.
   * Sellauth's user profile shows every device the account is signed
   * in on with IP / browser / OS / first+last login + a per-row Logout
   * button + a "Logout Other Devices" button. Closes the gap so a
   * customer who suspects their cookie was stolen on a public machine
   * can self-service the cleanup instead of having to email the operator.
   *
   * Token values are NEVER returned. We expose a 12-char prefix of
   * sha256(token) — enough to identify a row across the audit trail
   * without ever holding raw cookie material in the response.
   */
  .get("/sessions", async ({ cookie, set }) => {
    const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
    const sessionUser = await validateSession(tok);
    if (!sessionUser) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHENTICATED" };
    }
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, sessionUser.id))
      .orderBy(desc(sessions.lastSeenAt));
    const currentId = tok ? createHash("sha256").update(tok).digest("hex") : null;
    return {
      sessions: rows.map((s) => ({
        // 12-char prefix of the stored sha256 — non-reversible to the
        // cookie but unique enough to identify a row in the audit log.
        id: s.token.slice(0, 12),
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        ipAddress: s.ipAddress,
        lastIp: s.lastIp,
        userAgent: s.userAgent,
        current: s.token === currentId,
      })),
    };
  })

  /* "Sign out of all other devices" — keps the actor's own session so
   * they don't immediately bounce back to /login. Best-effort audit via
   * logAuthEvent so the actor's email shows up in the activity stream
   * the same way admin revocations do. */
  .post("/sessions/revoke-others", async ({ cookie, request, set }) => {
    const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
    const sessionUser = await validateSession(tok);
    if (!sessionUser) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHENTICATED" };
    }
    const ip = clientIp(request);
    const revoked = await revokeOtherSessions(sessionUser.id, tok);
    if (revoked > 0) {
      void logAuthEvent(
        sessionUser.email,
        "logout",
        ip,
        `(revoked ${revoked} other session${revoked === 1 ? "" : "s"} from /account)`,
      );
    }
    return { ok: true, revokedSessions: revoked };
  })

  /* Surgical per-row revoke. Same shape as the admin endpoint:
   *   - Reject malformed id prefixes up front (anti-typo, anti-scan).
   *   - Scope the lookup to (userId == actor.id) so a forged id from
   *     someone else's account can never match.
   *   - Refuse self-revoke — actor uses /logout for that path. */
  .post(
    "/sessions/:id/revoke",
    async ({ params: { id }, cookie, set, request }) => {
      const tok = cookie[SESSION_COOKIE]?.value as string | undefined;
      const sessionUser = await validateSession(tok);
      if (!sessionUser) {
        set.status = 401;
        return { error: "Authentication required", code: "UNAUTHENTICATED" };
      }
      if (typeof id !== "string" || id.length < 8 || !/^[0-9a-f]+$/.test(id)) {
        set.status = 400;
        return { error: "Invalid session id", code: "BAD_ID" };
      }
      const currentId = tok ? createHash("sha256").update(tok).digest("hex") : null;
      const own = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, sessionUser.id));
      const target = own.find((s) => s.token.startsWith(id));
      if (!target) {
        set.status = 404;
        return { error: "Session not found", code: "NOT_FOUND" };
      }
      if (target.token === currentId) {
        set.status = 400;
        return {
          error: "Refusing to revoke the current session — use logout instead",
          code: "SELF_REVOKE",
        };
      }
      await db.delete(sessions).where(eq(sessions.token, target.token));
      void logAuthEvent(
        sessionUser.email,
        "logout",
        clientIp(request),
        `(revoked session ${id} from /account)`,
      );
      return { ok: true };
    },
  );

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
