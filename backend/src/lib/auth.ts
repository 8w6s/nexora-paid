import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { sessions, settings, users } from "../db/schema.ts";

/* ───────────────────────── password (argon2id via Bun) ───────────────────────── */
export const hashPassword = (pw: string) =>
  Bun.password.hash(pw, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });

export const verifyPassword = (pw: string, hash: string) => Bun.password.verify(pw, hash);

// Dummy hash to equalize timing when an email doesn't exist (anti-enumeration).
// Lazy-init: argon2id with our cost params takes 100-300ms; doing it at
// top-level await blocks the entire ESM graph during cold start. We don't
// need the dummy until the first failed-login attempt, so compute on demand
// and memoize the promise (handles concurrent first-login race for free).
let DUMMY_HASH_PROMISE: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => {
  if (!DUMMY_HASH_PROMISE) DUMMY_HASH_PROMISE = hashPassword("x".repeat(24));
  return DUMMY_HASH_PROMISE;
};
export async function verifyLogin(
  user: { passwordHash: string } | undefined,
  pw: string,
): Promise<boolean> {
  if (!user) {
    await verifyPassword(pw, await getDummyHash()); // spend the same time
    return false;
  }
  return verifyPassword(pw, user.passwordHash);
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/* ───────────────────────── opaque DB-backed sessions ─────────────── */
// Raw token lives in the cookie; only SHA-256(token) is stored, so a DB leak can't mint sessions.
// Two ceilings + an idle floor:
// - THIRTY_DAYS_MS: absolute customer cookie lifetime (signed-in convenience).
// - ADMIN_ABSOLUTE_MAX_MS: hard cap for admin sessions. SOC2 / ISO 27001
//   compliance regimes typically require admin re-auth at ≤8h.
// - CUSTOMER_IDLE_MAX_MS / ADMIN_IDLE_MAX_MS: idle eviction. Without this
//   a stolen cookie remains valid up to the absolute cap regardless of activity.
//   Updated on each validateSession() call.
//
// Throttle the per-call lastSeenAt write with LAST_SEEN_REFRESH_MS so we don't
// turn every API request into a write — only update when the gap is larger
// than the throttle, which still bounds idle-eviction to that granularity.
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
const ADMIN_ABSOLUTE_MAX_MS = 1000 * 60 * 60 * 8; // 8h hard cap for admin sessions
const CUSTOMER_IDLE_MAX_MS = 1000 * 60 * 60 * 24; // 24h idle for customers
const ADMIN_IDLE_MAX_MS = 1000 * 60 * 60; // 1h idle for admins
const LAST_SEEN_REFRESH_MS = 1000 * 60; // throttle: only update lastSeenAt every 60s
export const SESSION_COOKIE = "sid";

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Optional context passed to createSession()/validateSession() so the
 * device-list UI can surface where each session came from. All fields
 * are best-effort — clientIp() upstream already collapses an X-Forwarded-
 * For chain to one address, and a missing User-Agent header just stores
 * NULL.
 */
export type SessionContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export async function createSession(
  userId: string,
  role: "customer" | "admin" = "customer",
  ctx: SessionContext = {},
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex"); // 256-bit
  const id = sha256hex(token);
  // Admin sessions get the 8h hard cap regardless of role at validate time
  // — keeps this consistent with the per-request idle ceiling.
  const lifetimeMs = role === "admin" ? ADMIN_ABSOLUTE_MAX_MS : THIRTY_DAYS_MS;
  const expiresAt = Date.now() + lifetimeMs;
  const now = new Date();
  // Truncate the UA so a pathological 100KB header can't bloat a row.
  // 500 chars covers every legitimate real-world UA with margin.
  const ua = ctx.userAgent ? ctx.userAgent.slice(0, 500) : null;
  const ip = ctx.ip ?? null;
  await db.insert(sessions).values({
    token: id,
    userId,
    expiresAt: new Date(expiresAt),
    lastSeenAt: now,
    ipAddress: ip,
    userAgent: ua,
    lastIp: ip,
  });
  return { token, expiresAt };
}

export type SessionUser = { id: string; email: string; role: "customer" | "admin" };

export async function validateSession(
  token: string | undefined,
  ctx: { ip?: string | null } = {},
): Promise<SessionUser | null> {
  if (!token) return null;
  const id = sha256hex(token);
  const rows = await db.select().from(sessions).where(eq(sessions.token, id));
  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  // Absolute expiry: hard ceiling regardless of activity.
  if (now > new Date(row.expiresAt).getTime()) {
    await db.delete(sessions).where(eq(sessions.token, id));
    return null;
  }

  const u = (await db.select().from(users).where(eq(users.id, row.userId)))[0];
  if (!u) return null;
  // Refuse banned OR deleted customers even if their session row hasn't
  // been swept yet. "deleted" is the soft-delete state set by the GDPR
  // erasure flow — the user's PII has been scrubbed and they cannot
  // log in again under the deleted-...@deleted.invalid email value.
  if (u.status === "banned" || u.status === "deleted") {
    await db.delete(sessions).where(eq(sessions.token, id));
    return null;
  }

  // Idle eviction: stricter for admins. A stolen cookie that the legitimate
  // user never notices drops out via this path long before the absolute cap.
  const idleMs = u.role === "admin" ? ADMIN_IDLE_MAX_MS : CUSTOMER_IDLE_MAX_MS;
  const lastSeenMs = new Date(row.lastSeenAt).getTime();
  if (now - lastSeenMs > idleMs) {
    await db.delete(sessions).where(eq(sessions.token, id));
    return null;
  }

  // Touch lastSeenAt at most once per LAST_SEEN_REFRESH_MS — keeps writes
  // cheap (high-traffic users would otherwise write on every request) while
  // still bounding the idle-eviction granularity. Refresh lastIp at the
  // same cadence so the device-list UI reflects roaming (mobile → wifi)
  // without a write per request.
  if (now - lastSeenMs > LAST_SEEN_REFRESH_MS) {
    const newIp = ctx.ip ?? row.lastIp ?? null;
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now), lastIp: newIp })
      .where(eq(sessions.token, id));
  }

  return { id: u.id, email: u.email, role: u.role };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.token, sha256hex(token)));
}

/**
 * Evict every session for `userId` EXCEPT the one belonging to `currentToken`.
 * Used after sensitive state changes (password rotate, 2FA enable/disable/recover,
 * admin role grant) so a stolen cookie issued before the change can't outlive
 * it. The current session survives so the actor doesn't log themselves out
 * mid-flow. Pass `currentToken=undefined` to revoke ALL sessions including the
 * current one.
 */
export async function revokeOtherSessions(
  userId: string,
  currentToken: string | undefined,
): Promise<number> {
  const all = await db.select().from(sessions).where(eq(sessions.userId, userId));
  const currentId = currentToken ? sha256hex(currentToken) : null;
  const toDrop = all.filter((s) => s.token !== currentId).map((s) => s.token);
  if (toDrop.length === 0) return 0;
  // Drizzle/SQLite doesn't have a clean "in array" delete via this builder
  // pattern in all versions, so loop. Sessions tables are small (admin only
  // has a handful of devices) so per-row delete is fine.
  for (const id of toDrop) {
    await db.delete(sessions).where(eq(sessions.token, id));
  }
  return toDrop.length;
}

/**
 * Decide whether the session cookie must carry the Secure flag.
 *
 * Previously secure was tied to NODE_ENV=production, which meant a "soft launch"
 * staging deploy without that env set would ship admin cookies over plaintext
 * HTTP. The right invariant is: if PUBLIC_ORIGIN uses HTTPS, the cookie must be
 * Secure; if PUBLIC_ORIGIN is non-localhost http://, refuse cookie auth entirely
 * because there is no safe behaviour (Secure-flagged cookies would be dropped
 * by the browser, non-Secure cookies leak the session id over the wire).
 */
function resolveCookieSecurity(): { secure: boolean; allowed: boolean } {
  const origin = Bun.env.PUBLIC_ORIGIN ?? "http://localhost:4321";
  if (origin.startsWith("https://")) return { secure: true, allowed: true };
  // Allow plaintext only on loopback — explicit allowlist, not just "is dev".
  const isLoopback =
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://[::1]");
  return { secure: false, allowed: isLoopback };
}

export function sessionCookieOptions(expires: Date) {
  const { secure, allowed } = resolveCookieSecurity();
  if (!allowed) {
    // Hard fail: setting cookies in this state would leak the session over
    // plaintext to a non-loopback origin. Caller should have validated this
    // at boot, but we belt-and-braces here in case PUBLIC_ORIGIN changes
    // mid-process or the boot guard was somehow bypassed.
    throw new Error(
      "Refusing to issue session cookie: PUBLIC_ORIGIN is non-loopback http:// — set HTTPS or restrict to localhost.",
    );
  }
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/api",
    expires,
  };
}

/* ─────────────────── order-token HMAC secret (per-deploy random) ───────────────────
 * Token used by guest order pages (`?token=…`). Previous behavior fell back to a
 * hardcoded string when ADMIN_PASSWORD_HASH was unset → an attacker who knew the
 * fallback could forge tokens for any orderId and read other customers' delivered
 * keys (CRITICAL IDOR). We now require an explicit secret. Sources, in order:
 *   1. ORDER_TOKEN_SECRET env var (highest priority — survives DB wipe).
 *   2. settings.order_token_secret (auto-provisioned random 32-byte hex on boot).
 * The token itself is HMAC-SHA256(secret, "v1:order:" + orderId) → switching the
 * version prefix or the secret invalidates outstanding guest links, which is the
 * desired property when rotating after a suspected compromise.
 *
 * Versioning: the prefix `v1:` is reserved so we can ship a `v2:` (e.g. binding
 * userId or createdAt) without breaking outstanding links — verifier accepts
 * any known version, generator emits the latest.
 */
let ORDER_TOKEN_SECRET_CACHE: string | null = null;

async function getOrderTokenSecret(): Promise<string> {
  if (ORDER_TOKEN_SECRET_CACHE) return ORDER_TOKEN_SECRET_CACHE;
  const env = Bun.env.ORDER_TOKEN_SECRET;
  if (env && env.length >= 32) {
    ORDER_TOKEN_SECRET_CACHE = env;
    return env;
  }
  // Fall back to a DB-persisted, lazy-generated random secret. SQLite serializes
  // writes so a concurrent first-boot is safe (UNIQUE on settings.key).
  const existing = (
    await db.select().from(settings).where(eq(settings.key, "order_token_secret"))
  )[0];
  if (existing?.value && existing.value.length >= 32) {
    ORDER_TOKEN_SECRET_CACHE = existing.value;
    return existing.value;
  }
  const fresh = randomBytes(32).toString("hex");
  try {
    await db.insert(settings).values({ key: "order_token_secret", value: fresh });
    ORDER_TOKEN_SECRET_CACHE = fresh;
    return fresh;
  } catch {
    // Lost the race — re-read the row the winner inserted.
    const row = (await db.select().from(settings).where(eq(settings.key, "order_token_secret")))[0];
    const v = row?.value && row.value.length >= 32 ? row.value : fresh;
    ORDER_TOKEN_SECRET_CACHE = v;
    return v;
  }
}

// Synchronous wrappers kept for hot paths (checkout response). Throw if the
// secret hasn't been primed yet — callers should `await primeOrderTokenSecret()`
// during boot. We prime in index.ts immediately after bootstrapAdmin().
//
// `generateOrderToken(orderId)` — version-1 token, suitable for guest orders
// where the buyer is identified only by email. Anyone with the orderId AND the
// token can view the order.
//
// `generateOrderTokenForUser(orderId, userId)` — version-2 token, binds the
// token to a specific user id. Only the owner (after authenticating again)
// would be able to forge an equivalent token, since the user id is part of
// the HMAC payload. We don't currently use v2 in the response (the existing
// checkout response stays compatible with guest flows), but verifyOrderToken
// will accept either flavor so a future client can opt in without a server
// upgrade dance.
export function generateOrderToken(orderId: string): string {
  if (!ORDER_TOKEN_SECRET_CACHE) {
    throw new Error("ORDER_TOKEN_SECRET not initialized — call primeOrderTokenSecret() at boot");
  }
  return createHmac("sha256", ORDER_TOKEN_SECRET_CACHE).update(`v1:order:${orderId}`).digest("hex");
}

export function generateOrderTokenForUser(orderId: string, userId: string): string {
  if (!ORDER_TOKEN_SECRET_CACHE) {
    throw new Error("ORDER_TOKEN_SECRET not initialized — call primeOrderTokenSecret() at boot");
  }
  return createHmac("sha256", ORDER_TOKEN_SECRET_CACHE)
    .update(`v2:order:${orderId}:user:${userId}`)
    .digest("hex");
}

export async function primeOrderTokenSecret(): Promise<void> {
  await getOrderTokenSecret();
}

// Constant-time hex compare on equal-length buffers. Returns false on any
// length mismatch without leaking via early-exit timing.
function ctEqHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // burn equivalent work
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function verifyOrderToken(
  orderId: string,
  token: string | undefined,
  userId?: string,
): boolean {
  if (!token) return false;
  // Reject any token that isn't a 64-char hex string up front so an attacker
  // can't probe with arbitrary-length buffers.
  if (typeof token !== "string" || token.length !== 64 || !/^[0-9a-f]+$/i.test(token)) return false;
  if (!ORDER_TOKEN_SECRET_CACHE) return false; // pre-boot — refuse.
  // Try v1 (guest token). If a userId was supplied, ALSO try v2 — either
  // flavor is acceptable: callers that don't have a user in context just
  // omit userId and v2 is silently skipped.
  const v1 = generateOrderToken(orderId);
  if (ctEqHex(v1, token)) return true;
  if (userId) {
    const v2 = generateOrderTokenForUser(orderId, userId);
    if (ctEqHex(v2, token)) return true;
  }
  return false;
}
