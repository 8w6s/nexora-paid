/**
 * Integrity verifier smoke tests.
 *
 * Covers every IntegrityResult variant the verifier can produce WITHOUT
 * requiring the build private key (which only lives on the release signer):
 *   - dev_skip            → opts.devSkip or NEXORA_DEV_SKIP_INTEGRITY env
 *   - manifest_not_found  → resolveManifestPath misses every candidate
 *   - manifest_malformed  → invalid JSON, missing fields, wrong version
 *   - signature_invalid   → well-formed manifest but signature doesn't verify
 *   - summarizeResult     → operator-friendly string for every shape
 *
 * The `files_mismatch` and `ok=true` happy paths require a valid ed25519
 * signature against the build pubkey; they are exercised by the release
 * pipeline (scripts/build-manifest.ts) and are out of scope here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveManifestPath, summarizeResult, verifyManifest } from "./integrity.ts";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "nexora-integrity-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("verifyManifest — failure paths", () => {
  test("devSkip=true short-circuits to skipped result", async () => {
    const r = await verifyManifest({ devSkip: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skipped).toBe(true);
  });

  test("manifest_not_found when path is bogus", async () => {
    const r = await verifyManifest({
      manifestPath: join(workDir, "does-not-exist.json"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("manifest_not_found");
  });

  test("manifest_malformed on invalid JSON", async () => {
    const p = join(workDir, "manifest.signed.json");
    writeFileSync(p, "{not json");
    const r = await verifyManifest({ manifestPath: p });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("manifest_malformed");
  });

  test("manifest_malformed when required fields missing", async () => {
    const p = join(workDir, "manifest.signed.json");
    writeFileSync(p, JSON.stringify({ payload: {}, signature: "deadbeef" }));
    const r = await verifyManifest({ manifestPath: p });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("manifest_malformed");
  });

  test("manifest_malformed when payload.version is not 1", async () => {
    const p = join(workDir, "manifest.signed.json");
    writeFileSync(
      p,
      JSON.stringify({
        payload: {
          version: 2,
          buildId: "x",
          customerId: null,
          issuedAt: "2026-01-01T00:00:00.000Z",
          files: {},
        },
        signature: "ab".repeat(32),
      }),
    );
    const r = await verifyManifest({ manifestPath: p });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("manifest_malformed");
  });

  test("signature_invalid when signature does not verify against build pubkey", async () => {
    const p = join(workDir, "manifest.signed.json");
    writeFileSync(
      p,
      JSON.stringify({
        payload: {
          version: 1,
          buildId: "test-build",
          customerId: null,
          issuedAt: "2026-01-01T00:00:00.000Z",
          files: {},
        },
        // 64-byte hex but cryptographically not a signature over the payload.
        signature: "00".repeat(64),
      }),
    );
    const r = await verifyManifest({ manifestPath: p });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("signature_invalid");
      expect(r.buildId).toBe("test-build");
    }
  });

  test("tamper smoke: flipping payload bytes keeps result=signature_invalid", async () => {
    // We don't have the private key, but any signature over a tampered
    // payload must fail verification — that's the whole point of the gate.
    const p = join(workDir, "manifest.signed.json");
    writeFileSync(
      p,
      JSON.stringify({
        payload: {
          version: 1,
          buildId: "tampered",
          customerId: "evil-customer",
          issuedAt: "2026-01-01T00:00:00.000Z",
          files: { "src/index.ts": "ff".repeat(32) },
        },
        signature: "ab".repeat(64),
      }),
    );
    const r = await verifyManifest({ manifestPath: p });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_invalid");
  });
});

describe("resolveManifestPath", () => {
  test("returns null when nothing matches", () => {
    const r = resolveManifestPath({ manifestPath: join(workDir, "nope.json") });
    expect(r).toBeNull();
  });

  test("returns the explicit manifestPath when it exists", () => {
    const p = join(workDir, "manifest.signed.json");
    writeFileSync(p, "{}");
    const r = resolveManifestPath({ manifestPath: p });
    expect(r).toBe(p);
  });
});

describe("summarizeResult", () => {
  test("dev_skip → SKIPPED message", () => {
    const s = summarizeResult({ ok: true, skipped: true, reason: "dev_skip" });
    expect(s).toContain("SKIPPED");
  });

  test("ok → OK build=... files=N", () => {
    const s = summarizeResult({
      ok: true,
      skipped: false,
      buildId: "abc",
      customerId: null,
      issuedAt: "2026-01-01T00:00:00.000Z",
      checked: 42,
    });
    expect(s).toContain("OK");
    expect(s).toContain("abc");
    expect(s).toContain("42");
  });

  test("fail with no mismatches → reason only", () => {
    const s = summarizeResult({ ok: false, reason: "manifest_not_found", mismatches: [] });
    expect(s).toContain("FAIL");
    expect(s).toContain("manifest_not_found");
  });

  test("fail with mismatches → first 3 paths, +more suffix when over", () => {
    const s = summarizeResult({
      ok: false,
      reason: "files_mismatch",
      mismatches: [
        { path: "a.ts", expected: "aa", actual: "bb" },
        { path: "b.ts", expected: "aa", actual: "bb" },
        { path: "c.ts", expected: "aa", actual: "bb" },
        { path: "d.ts", expected: "aa", actual: "bb" },
      ],
    });
    expect(s).toContain("a.ts");
    expect(s).toContain("b.ts");
    expect(s).toContain("c.ts");
    expect(s).toContain("+1 more");
  });
});
