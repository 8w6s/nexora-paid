#!/usr/bin/env bun
/**
 * Sign a version manifest JSON with the same ed25519 key used for licenses
 * and the integrity manifest. Output is a `<name>.signed.json` whose shape
 * matches updater/manifest-verify.ts → SignedManifest.
 *
 * Usage:
 *   bun run scripts/sign-manifest.ts \
 *     --in=releases-template/versions/stable.json \
 *     --out=releases-template/versions/stable.signed.json
 *
 * Default --out replaces the input file's `.json` suffix with `.signed.json`.
 * Refuses to overwrite an existing --out (use --force to override).
 *
 * The signing key is loaded from .keys/license-signer.private (same file
 * scripts/build-manifest.ts + scripts/sign-license.ts read). The byte order
 * for hashing matches updater/manifest-verify's canonicalize(): sorted keys
 * recursively, no whitespace.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

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

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("malformed hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// biome-ignore lint/suspicious/noConsole: CLI script — output is the deliverable
const log = (msg: string) => console.log(`[sign-manifest] ${msg}`);
// biome-ignore lint/suspicious/noConsole: CLI script — stderr for failures
const err = (msg: string) => console.error(`[sign-manifest] ${msg}`);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in;
  if (!inPath) {
    err("FATAL: usage: bun run scripts/sign-manifest.ts --in=<path> [--out=<path>] [--force]");
    return 1;
  }
  const outPath =
    args.out ?? inPath.replace(/\.json$/, ".signed.json").replace(/^(?!.*\.signed\.json$)/, "");
  if (!existsSync(inPath)) {
    err(`FATAL: input not found: ${inPath}`);
    return 1;
  }
  if (existsSync(outPath) && args.force !== "true") {
    err(`FATAL: refusing to overwrite ${outPath} (pass --force to override)`);
    return 1;
  }

  const keyPath = resolve(process.cwd(), ".keys/license-signer.private");
  if (!existsSync(keyPath)) {
    err(`FATAL: signing key missing at ${keyPath}`);
    err("Run: bun run scripts/gen-keypair.ts");
    return 1;
  }
  const privHex = readFileSync(keyPath, "utf8").trim();
  let priv: Uint8Array;
  try {
    priv = hexToBytes(privHex);
  } catch (e) {
    err(`FATAL: signing key malformed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(inPath, "utf8"));
  } catch (e) {
    err(`FATAL: input is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("latest" in payload) ||
    !("imageRepo" in payload) ||
    !("imageTag" in payload)
  ) {
    err("FATAL: payload missing required fields (latest, imageRepo, imageTag)");
    return 1;
  }

  const canonical = canonicalize(payload);
  const bytes = new TextEncoder().encode(canonical);
  const sig = await ed.sign(bytes, priv);
  const out = { payload, signature: bytesToHex(sig) };
  writeFileSync(
    outPath,
    `${JSON.stringify(out, null, 2)}
`,
  );
  log(`wrote ${outPath} (payload ${bytes.length}B, sig 64B)`);
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    err(`FATAL: unhandled — ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
