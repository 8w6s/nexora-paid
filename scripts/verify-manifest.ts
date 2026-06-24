#!/usr/bin/env bun
/**
 * Standalone CLI wrapper around `backend/src/lib/integrity.ts → verifyManifest`.
 *
 * Used in two places:
 *   1. Local dev — quick "did I just break the manifest?" check after a code
 *      change: `bun run scripts/verify-manifest.ts`.
 *   2. CI smoke test — the release pipeline runs this between
 *      `scripts/build-manifest.ts` and shipping the tarball; non-zero exit
 *      means the manifest the build wrote does NOT round-trip through the
 *      verifier, i.e. canonicalize() drift between writer and reader. That
 *      drift would silently break every customer's boot, so we catch it
 *      pre-ship.
 *
 *   bun run scripts/verify-manifest.ts                  # auto-discover manifest
 *   bun run scripts/verify-manifest.ts --manifest=./manifest.signed.json
 */
import { summarizeResult, verifyManifest } from "../backend/src/lib/integrity.ts";

const args = parseArgs(process.argv.slice(2));

const result = await verifyManifest({
  manifestPath: args.manifest,
  // Always run the real check from this CLI — don't honour
  // NEXORA_DEV_SKIP_INTEGRITY here. The whole point of this script is to
  // test the verifier, so a "skip" would defeat the purpose.
  devSkip: false,
});

console.log(summarizeResult(result));
if (!result.ok) {
  if (result.mismatches.length > 0) {
    console.error("");
    console.error("Mismatches:");
    for (const m of result.mismatches.slice(0, 20)) {
      console.error(`  ${m.path}`);
      console.error(`    expected: ${m.expected}`);
      console.error(`    actual  : ${m.actual ?? "(missing)"}`);
    }
    if (result.mismatches.length > 20) {
      console.error(`  … +${result.mismatches.length - 20} more`);
    }
  }
  process.exit(1);
}

console.log("");
console.log("Round-trip OK. Manifest writer + verifier agree on canonical JSON.");

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out[a.slice(2)] = "true";
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}
