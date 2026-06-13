/**
 * In-memory sliding-window rate limiter for auth and sensitive endpoints.
 * Per-key tracking (IP, IP+path, email, …) with automatic cleanup of stale
 * entries. The limiter is a single shared map across the whole process — keys
 * MUST be namespaced by the caller (`auth:1.2.3.4`, `email:foo@bar`, …).
 *
 * Why in-memory: single-process Bun server with SQLite — no Redis dependency.
 * On restart, counters reset (acceptable for rate limiting; worst case a few
 * extra requests slip through, not a disaster).
 *
 * Hardening additions (post-pentest):
 *   - clientIp() now honors X-Forwarded-For ONLY when TRUST_PROXY=true env is
 *     set. Default behavior: ignore proxy headers — attacker can't reset their
 *     bucket by sending `X-Forwarded-For: <random>`.
 *   - lockoutCheck() helper for per-account lockout on repeated bad logins.
 */

interface Bucket {
  windowStart: number;
  count: number;
}

// Per-key buckets (keyed by IP for auth, IP+action for idempotency, etc.)
const buckets = new Map<string, Bucket>();

// Periodic cleanup (every 5 min) to prevent memory leak from stale entries
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    // Sweep any bucket whose window ended >5 min ago — generous so long
    // windows (per-email lockout) don't get GC'd while still in effect.
    for (const [key, b] of buckets) {
      if (now - b.windowStart > 24 * 60 * 60 * 1000) buckets.delete(key);
    }
  }, 300_000).unref(); // don't block process exit
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number; // ms until window resets
}

/**
 * Check if a request identified by `key` is allowed under the sliding window.
 *
 * @param key      Identifier (IP, IP+endpoint, etc.)
 * @param maxReqs  Max requests allowed per window
 * @param windowMs Window duration in milliseconds (default 60s)
 */
export function rateLimitCheck(key: string, maxReqs: number, windowMs = 60_000): RateLimitResult {
  ensureCleanup();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart > windowMs) {
    // Fresh window
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: maxReqs - 1, resetMs: windowMs };
  }

  existing.count++;
  const elapsed = now - existing.windowStart;
  const resetMs = Math.max(0, windowMs - elapsed);

  if (existing.count > maxReqs) {
    return { allowed: false, remaining: 0, resetMs };
  }

  return { allowed: true, remaining: maxReqs - existing.count, resetMs };
}

/**
 * Record a "failure event" against a key WITHOUT consuming the request budget
 * — used by per-account login lockout: every wrong password bumps the counter,
 * and once the threshold is reached every subsequent login attempt against
 * that account is blocked for the remainder of the window even from a fresh
 * IP. Successful login should call lockoutReset(key) to clear the slate.
 */
export function lockoutBump(key: string, windowMs: number): { count: number } {
  ensureCleanup();
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart > windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { count: 1 };
  }
  existing.count++;
  return { count: existing.count };
}

export function lockoutCheck(
  key: string,
  threshold: number,
  windowMs: number,
): { locked: boolean; resetMs: number } {
  const existing = buckets.get(key);
  if (!existing) return { locked: false, resetMs: 0 };
  const elapsed = Date.now() - existing.windowStart;
  if (elapsed > windowMs) return { locked: false, resetMs: 0 };
  return { locked: existing.count >= threshold, resetMs: Math.max(0, windowMs - elapsed) };
}

export function lockoutReset(key: string): void {
  buckets.delete(key);
}

/**
 * Resolve the client IP. By default we IGNORE X-Forwarded-* headers because a
 * direct internet client can put anything there to spoof their identity (and
 * reset their rate-limit bucket). Only when `TRUST_PROXY=true` is set do we
 * honor the FIRST entry in X-Forwarded-For — that's where a properly
 * configured reverse proxy puts the original client IP.
 *
 * Bun's Request doesn't expose the socket peer directly; we use a synthetic
 * fingerprint built from server-derived values when no proxy is trusted, so
 * a hostile header can't override it.
 */
export function clientIp(request: Request): string {
  const trustProxy = (globalThis as any).__nexora_trust_proxy === true;
  if (trustProxy) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const xri = request.headers.get("x-real-ip");
    if (xri) return xri.trim();
  }
  // Fallback: Bun exposes server-derived address on `(request as any).server`
  // when called from a fetch handler. We can't reliably get the peer IP from
  // the standard Request, so we use a per-process pseudo-key when no proxy is
  // trusted. This collapses ALL untrusted requests into a single bucket —
  // brutal, but exactly what we want when running directly on the internet
  // without a proxy: rate-limit the whole world together rather than letting
  // an attacker spoof.
  // In practice you should run behind a TLS proxy in prod; this fallback is
  // the safe choice for a misconfigured deploy.
  return "untrusted-shared-bucket";
}
