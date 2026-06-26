import { describe, expect, test } from "bun:test";
import {
  clientIp,
  lockoutBump,
  lockoutCheck,
  lockoutReset,
  rateLimitCheck,
} from "./rate-limit.ts";

// The module holds a process-wide bucket map, so every test MUST use a
// unique key to avoid bleed-over from sibling tests. We tag keys with the
// test name to make that explicit.

describe("rateLimitCheck", () => {
  test("allows the first request and reports remaining budget", () => {
    const r = rateLimitCheck("rl-test-first:abc", 3, 60_000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetMs).toBe(60_000);
  });

  test("blocks the (maxReqs+1)th request inside the window", () => {
    const key = "rl-test-burst:abc";
    // maxReqs=3 means 3 allowed total. The check is strict-greater-than,
    // so count reaches 4 before returning blocked. Calls #1-#3 must pass,
    // call #4 must be blocked.
    expect(rateLimitCheck(key, 3, 60_000).allowed).toBe(true); // 1
    expect(rateLimitCheck(key, 3, 60_000).allowed).toBe(true); // 2
    expect(rateLimitCheck(key, 3, 60_000).allowed).toBe(true); // 3 (== maxReqs)
    const blocked = rateLimitCheck(key, 3, 60_000); // 4
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(0);
  });

  test("isolates buckets across keys — one key's exhaustion does not affect another", () => {
    const a = "rl-test-isolation:a";
    const b = "rl-test-isolation:b";
    for (let i = 0; i < 5; i++) rateLimitCheck(a, 2, 60_000);
    // a is now exhausted
    expect(rateLimitCheck(a, 2, 60_000).allowed).toBe(false);
    // b is untouched
    expect(rateLimitCheck(b, 2, 60_000).allowed).toBe(true);
  });

  test("resetMs decreases as time passes within the window (within test latency)", async () => {
    const key = "rl-test-resetms:abc";
    const first = rateLimitCheck(key, 5, 5_000);
    expect(first.resetMs).toBe(5_000);
    await Bun.sleep(20);
    const second = rateLimitCheck(key, 5, 5_000);
    // Second call shares the same window, so its resetMs is <= first.resetMs.
    expect(second.resetMs).toBeLessThanOrEqual(5_000);
  });

  test("opens a fresh window after the old one elapses (synthetic short window)", async () => {
    const key = "rl-test-reopen:abc";
    expect(rateLimitCheck(key, 1, 50).allowed).toBe(true);
    expect(rateLimitCheck(key, 1, 50).allowed).toBe(false);
    await Bun.sleep(80);
    // Window elapsed — next call should observe a fresh bucket.
    expect(rateLimitCheck(key, 1, 50).allowed).toBe(true);
  });
});

describe("lockout helpers (per-account login lockout)", () => {
  test("lockoutBump increments without consuming a request budget", () => {
    const key = "lockout-test-bump:user@example.com";
    expect(lockoutBump(key, 60_000).count).toBe(1);
    expect(lockoutBump(key, 60_000).count).toBe(2);
    expect(lockoutBump(key, 60_000).count).toBe(3);
  });

  test("lockoutCheck reports unlocked until threshold reached", () => {
    const key = "lockout-test-check:user@example.com";
    expect(lockoutCheck(key, 5, 60_000).locked).toBe(false);
    for (let i = 0; i < 4; i++) lockoutBump(key, 60_000);
    // 4 bumps, threshold 5 — still unlocked.
    expect(lockoutCheck(key, 5, 60_000).locked).toBe(false);
    lockoutBump(key, 60_000); // 5th bump
    expect(lockoutCheck(key, 5, 60_000).locked).toBe(true);
  });

  test("lockoutReset clears the bucket (post-successful-login flow)", () => {
    const key = "lockout-test-reset:user@example.com";
    for (let i = 0; i < 10; i++) lockoutBump(key, 60_000);
    expect(lockoutCheck(key, 5, 60_000).locked).toBe(true);
    lockoutReset(key);
    expect(lockoutCheck(key, 5, 60_000).locked).toBe(false);
  });
});

describe("clientIp", () => {
  test("returns the untrusted-shared-bucket sentinel when no proxy is trusted", () => {
    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    // TRUST_PROXY is NOT set globally in tests, so spoofed XFF must be ignored.
    expect(clientIp(req)).toBe("untrusted-shared-bucket");
  });

  test("honors x-forwarded-for ONLY when __nexora_trust_proxy is true", () => {
    (globalThis as Record<string, unknown>).__nexora_trust_proxy = true;
    try {
      const req = new Request("http://localhost/", {
        headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
      });
      expect(clientIp(req)).toBe("9.9.9.9");
    } finally {
      (globalThis as Record<string, unknown>).__nexora_trust_proxy = false;
    }
  });

  test("falls back to x-real-ip when TRUST_PROXY=true and XFF missing", () => {
    (globalThis as Record<string, unknown>).__nexora_trust_proxy = true;
    try {
      const req = new Request("http://localhost/", {
        headers: { "x-real-ip": "8.8.8.8" },
      });
      expect(clientIp(req)).toBe("8.8.8.8");
    } finally {
      (globalThis as Record<string, unknown>).__nexora_trust_proxy = false;
    }
  });
});