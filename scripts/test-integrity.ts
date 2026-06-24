#!/usr/bin/env bun
/**
 * Tamper smoke test for the signed integrity manifest.
 *
 * Round-trips every failure mode that matters for paid protection:
 *   1. fresh build -> verify OK
 *   2. tamper one protected file -> verify FAIL (files_mismatch) -> restore -> OK
 *   3. tamper the manifest payload (flip buildId) -> verify FAIL (signature_invalid)
 *
 * Acceptance: exits 0 on full round-trip, exits 1 on any deviation. Safe to
 * re-run: every mutation is paired with an exact byte-level restore inside
 * try/finally, so a crashed run does not leave a tampered backend source
 * file on disk.
 *
 * Why this matters: the boot path (`backend/src/index.ts`) calls
 * `initIntegrity()` before `loadPlugins()`. If the verifier silently
 * regresses (e.g. canonicalize() drift between writer and reader, or a
 * future change that forgets to fail-closed), paid plugins would still
 * load on a patched binary and the entire paid-protection promise breaks.
 * This script catches that regression in one command.
 *
 * Usage:
 *   bun run scripts/test-integrity.ts            # from repo root
 *   bun run test:integrity                        # via root package.json
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { summarizeResult, verifyManifest } from "../backend/src/lib/integrity.ts";

const ROOT = process.cwd();
const MANIFEST = resolve(ROOT, "manifest.test.signed.json");

// File we mutate to force a files_mismatch. Picked because:
//   - lives under the manifest's coverage (backend/src/**)
//   - is doc-only (NEXORA_VERSION const) so a crash mid-run still leaves
//     the source parseable
//   - byte-stable across platforms thanks to `.gitattributes` LF pinning
const TAMPER_TARGET = resolve(ROOT, "backend/src/lib/version.ts");

// Trailer bytes built byte-by-byte so this source has no embeded newline
// inside any string literal (which previously tripped Bun on Windows CRLF).
// The bytes spell newline + "// tamper-smoke-test" + newline.
const TAMPER_TRAILER = Buffer.from([
  10, 47, 47, 32, 116, 97, 109, 112, 101, 114, 45, 115, 109, 111, 107, 101, 45, 116, 101, 115, 116,
  10,
]);

const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
    failures.push(label);
  }
}

async function step1_buildManifest(): Promise<void> {
  console.log("[1/3] build a fresh manifest");
  // Spawn the real CLI so we exercise the same argv parsing customers hit.
  // `--out` points at a sibling of the default path so this test never
  // clobbers a real manifest sitting next to the binary.
  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "run",
      "scripts/build-manifest.ts",
      "--build-id=test-integrity-smoke",
      "--customer=cus_smoke_test",
      `--out=${MANIFEST}`,
    ],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    console.error(proc.stderr.toString());
    throw new Error(`build-manifest.ts exited ${proc.exitCode}`);
  }
  assert("manifest file written", existsSync(MANIFEST));

  const r = await verifyManifest({ manifestPath: MANIFEST, devSkip: false });
  console.log(`     ${summarizeResult(r)}`);
  assert(
    "clean verify ok",
    r.ok === true,
    r.ok ? undefined : `reason=${(r as { reason: string }).reason}`,
  );
}

async function step2_tamperFile(): Promise<void> {
  console.log("[2/3] tamper a protected file -> expect files_mismatch");
  const original = readFileSync(TAMPER_TARGET);
  try {
    // Append marker bytes so the hash drifts but TypeScript still parses.
    // Restore is byte-for-byte from the captured buffer.
    writeFileSync(TAMPER_TARGET, Buffer.concat([original, Buffer.from(TAMPER_TRAILER)]));
    const r = await verifyManifest({ manifestPath: MANIFEST, devSkip: false });
    console.log(`     ${summarizeResult(r)}`);
    assert(
      "tampered file -> files_mismatch",
      r.ok === false && r.reason === "files_mismatch",
      r.ok ? "verifier said OK" : `reason=${r.reason}`,
    );
    if (r.ok === false && r.reason === "files_mismatch") {
      assert(
        "mismatch list includes tampered path",
        r.mismatches.some((m) => m.path.endsWith("backend/src/lib/version.ts")),
      );
    }
  } finally {
    // Byte-exact restore. Critical: a tampered version.ts left behind would
    // permanently break every future boot of this dev checkout.
    writeFileSync(TAMPER_TARGET, original);
  }
  // Re-verify after restore inside the same step so a corrupt restore
  // surfaces immediately rather than masquerading as a later failure.
  const r2 = await verifyManifest({ manifestPath: MANIFEST, devSkip: false });
  assert(
    "re-verify after restore ok",
    r2.ok === true,
    r2.ok ? undefined : `reason=${(r2 as { reason: string }).reason}`,
  );
}

async function step3_tamperManifest(): Promise<void> {
  console.log("[3/3] tamper the manifest payload -> expect signature_invalid");
  const original = readFileSync(MANIFEST, "utf-8");
  try {
    const signed = JSON.parse(original);
    signed.payload.buildId = "test-integrity-smoke-FORGED";
    writeFileSync(MANIFEST, JSON.stringify(signed, null, 2));
    const r = await verifyManifest({ manifestPath: MANIFEST, devSkip: false });
    console.log(`     ${summarizeResult(r)}`);
    assert(
      "tampered payload -> signature_invalid",
      r.ok === false && r.reason === "signature_invalid",
      r.ok ? "verifier said OK" : `reason=${r.reason}`,
    );
  } finally {
    writeFileSync(MANIFEST, original);
  }
}

async function main(): Promise<void> {
  console.log("=== integrity tamper smoke test ===");
  console.log(`root      : ${ROOT}`);
  console.log(`manifest  : ${MANIFEST}`);
  console.log(`target    : ${TAMPER_TARGET}`);
  console.log("");

  try {
    await step1_buildManifest();
    await step2_tamperFile();
    await step3_tamperManifest();
  } finally {
    // Always remove the test manifest -- it must not be confused with a real
    // customer manifest at the project root.
    if (existsSync(MANIFEST)) unlinkSync(MANIFEST);
  }

  console.log("");
  if (failures.length === 0) {
    console.log("PASS -- integrity verifier round-trips every failure mode.");
    process.exit(0);
  }
  console.error(`FAIL -- ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

await main();
