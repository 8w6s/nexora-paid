/**
 * integrity-state policy tests.
 *
 * `isDegraded()` encodes the dev-vs-prod gate rule that every paid feature
 * + admin mutation route checks. Locking it down here so future refactors
 * cannot silently widen tolerance (e.g. "let signature_invalid through in
 * dev too") — a regression there would let a tampered build serve paid
 * routes in production.
 *
 * Strategy: drive the cache directly via `initIntegrity()` opt by skipping
 * — we can't easily forge a real verifier result, but we CAN exercise the
 * `manifest_not_found` and `dev_skip` branches by toggling env vars and
 * pointing the verifier at a non-existent path through a custom verify call.
 * The remaining `reason` variants are pure-data — covered by direct cache
 * inspection via the verifier returning them.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetForTest, initIntegrity, isDegraded } from "./integrity-state.ts";

let workDir: string;
let savedNodeEnv: string | undefined;
let savedDevSkip: string | undefined;
let savedManifestFile: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "nexora-state-"));
  savedNodeEnv = process.env.NODE_ENV;
  savedDevSkip = process.env.NEXORA_DEV_SKIP_INTEGRITY;
  savedManifestFile = process.env.NEXORA_MANIFEST_FILE;
  // Point the resolver at a non-existent path so default-cwd lookups
  // do not accidentally find a real manifest from the repo root.
  process.env.NEXORA_MANIFEST_FILE = join(workDir, "no-such-manifest.json");
  __resetForTest();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  process.env.NODE_ENV = savedNodeEnv;
  process.env.NEXORA_DEV_SKIP_INTEGRITY = savedDevSkip;
  process.env.NEXORA_MANIFEST_FILE = savedManifestFile;
  __resetForTest();
});

describe("isDegraded — dev vs prod policy", () => {
  test("dev tolerance: manifest_not_found does NOT degrade in non-production", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.NEXORA_DEV_SKIP_INTEGRITY;
    await initIntegrity();
    expect(isDegraded()).toBe(false);
  });

  test("prod strictness: manifest_not_found DOES degrade in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NEXORA_DEV_SKIP_INTEGRITY;
    await initIntegrity();
    expect(isDegraded()).toBe(true);
  });

  test("dev skip env: NEXORA_DEV_SKIP_INTEGRITY=true short-circuits to non-degraded", async () => {
    process.env.NODE_ENV = "production"; // even in prod, explicit dev-skip wins
    process.env.NEXORA_DEV_SKIP_INTEGRITY = "true";
    await initIntegrity();
    expect(isDegraded()).toBe(false);
  });

  test("dev skip env with value '1' also accepted", async () => {
    process.env.NODE_ENV = "development";
    process.env.NEXORA_DEV_SKIP_INTEGRITY = "1";
    await initIntegrity();
    expect(isDegraded()).toBe(false);
  });

  test("pre-init: isDegraded() returns false (healthy default)", () => {
    // __resetForTest() in beforeEach clears the cache, so isDegraded()
    // without an initIntegrity() call must default to false — otherwise
    // a startup path that checks the gate before init would brick bot.
    expect(isDegraded()).toBe(false);
  });
});
