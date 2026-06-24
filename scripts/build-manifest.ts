#!/usr/bin/env bun
/**
 * Build the signed integrity manifest for a Paid release.
 *
 * Walks the security-critical source tree, computes SHA256 of every file
 * byte-for-byte, wraps the result in a payload, signs it with the maintainer's
 * ed25519 private key, and writes `manifest.signed.json` at the project root
 * (or wherever `--out` points).
 *
 * The Paid app's boot path calls `verifyManifest()` (see
 * `backend/src/lib/integrity.ts`). On hash mismatch the app enters degraded
 * mode: storefront stays read-only, paid plugins/mutations refuse to run,
 * data export still works. See `docs/SECURITY_ARCHITECTURE.md`.
 *   bun run scripts/build-manifest.ts \
 *     --build-id=build_2026-06-22_abc1234 \
 *     --customer=cus_001 \
 *     [--out=./manifest.signed.json]
 *
 * Key reuse (MVP simplification): manifest is signed with the SAME ed25519
 * key that signs `.license` files (`.keys/license-signer.private`). A
 * compromise of that key breaks BOTH layers. The integrity module embeds
 * the same public key. For v2+ we may split signers for defense-in-depth.
 *
 * Hash stability: file bytes are read as-is, no normalization. The repo's
 * `.gitattributes` pins LF endings so the hash matches across Linux CI
 * builds, Windows checkouts, and Docker container runtimes. If you build
 * on Windows with autocrlf=true your manifest WILL be wrong — don't.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

// @noble/ed25519 v3 needs a sync sha512 hook registered before any sign/verify.
if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

// ────────────────────────────────────────
// File selection — what we cover, what we deliberately skip.
//   - All TypeScript source under backend/src/** EXCEPT tests + dev-only seed.
//   - Top-level lockfile + manifest + tsconfig so a dependency swap is caught.
//   - Frontend src is NOT covered yet — it ships unminified at runtime via
//     Astro SSR and the file count is large; v1.1 focuses on the security-
//     critical backend surface. Frontend coverage lands in v1.2 with bundled
//     output (`frontend/dist/**`).
//   - data/, uploads/, logs/, node_modules/ are intentionally excluded:
//     they are runtime data, not security boundary code.
// ──────────────────────────────────────────────────────────────────────────

interface SourceGlob {
  root: string;
  recursive: boolean;
}

const SOURCE_GLOBS: SourceGlob[] = [{ root: "backend/src", recursive: true }];

const TOP_LEVEL_FILES = ["package.json", "bun.lock", "tsconfig.json"];

const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx", ".d.ts"];
const EXCLUDE_PATHS = new Set<string>(["backend/src/db/seed.ts"]);

interface ManifestPayload {
  version: 1;
  buildId: string;
  customerId: string | null;
  issuedAt: string;
  /** Map of repo-relative POSIX path → sha256 hex of file bytes. */
  files: Record<string, string>;
}

interface SignedManifest {
  payload: ManifestPayload;
  /** ed25519 signature of canonical-JSON payload bytes, hex. */
  signature: string;
}

const args = parseArgs(process.argv.slice(2));

if (!args["build-id"]) {
  console.error(
    "Usage: bun run scripts/build-manifest.ts --build-id=<id> [--customer=cus_xxx] [--out=./manifest.signed.json] [--root=.]",
  );
  process.exit(1);
}

const ROOT = resolve(args.root ?? process.cwd());
const OUT = resolve(args.out ?? join(ROOT, "manifest.signed.json"));
const BUILD_ID = String(args["build-id"]);
const CUSTOMER_ID = args.customer ? String(args.customer) : null;

const PRIV_PATH = resolve(ROOT, ".keys/license-signer.private");
if (!existsSync(PRIV_PATH)) {
  console.error(`!! No signing key at ${PRIV_PATH}`);
  console.error("!! Run: bun run scripts/gen-keypair.ts first.");
  process.exit(1);
}
const privBytes = hexToBytes(readFileSync(PRIV_PATH, "utf-8").trim());

// ─── Collect file list ────────────────────────────────────────────────────

function walkDir(absDir: string, acc: string[]) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) walkDir(abs, acc);
    else if (entry.isFile()) acc.push(abs);
  }
}

const collected: string[] = [];
for (const glob of SOURCE_GLOBS) {
  const absRoot = resolve(ROOT, glob.root);
  if (!existsSync(absRoot)) continue;
  if (glob.recursive) {
    walkDir(absRoot, collected);
  } else {
    for (const e of readdirSync(absRoot, { withFileTypes: true })) {
      if (e.isFile()) collected.push(join(absRoot, e.name));
    }
  }
}
for (const top of TOP_LEVEL_FILES) {
  const abs = resolve(ROOT, top);
  if (existsSync(abs) && statSync(abs).isFile()) collected.push(abs);
}

// Normalize to POSIX-relative + apply excludes + sort for deterministic output.
// We split on the OS separator (`\` on Windows, `/` on POSIX) and join with
// `/` so Linux CI + Windows checkout + Docker runtime all produce the same
// path strings (and therefore the same signature input).
const rel = collected
  .map((abs) => relative(ROOT, abs).split(sep).join("/"))
  .filter((p) => {
    if (EXCLUDE_PATHS.has(p)) return false;
    if (EXCLUDE_SUFFIXES.some((s) => p.endsWith(s))) return false;
    return true;
  })
  .sort();

if (rel.length === 0) {
  console.error("!! No files matched — check --root and SOURCE_GLOBS.");
  process.exit(1);
}

// ─── Hash + build payload ─────────────────────────────────────────────────

const files: Record<string, string> = {};
for (const p of rel) {
  const bytes = readFileSync(resolve(ROOT, p));
  files[p] = bytesToHex(sha256(bytes));
}

const payload: ManifestPayload = {
  version: 1,
  buildId: BUILD_ID,
  customerId: CUSTOMER_ID,
  issuedAt: new Date().toISOString(),
  files,
};

// Deterministic payload bytes for signing — sort keys at every object level
// via a custom replacer so the signature reproduces byte-for-byte regardless
// of insertion order. Arrays preserve order (semantically meaningful).
const payloadJson = canonicalize(payload);
const sig = await ed.sign(new TextEncoder().encode(payloadJson), privBytes);

const signed: SignedManifest = {
  payload: JSON.parse(payloadJson) as ManifestPayload,
  signature: bytesToHex(sig),
};

writeFileSync(
  OUT,
  `${JSON.stringify(signed, null, 2)}
`,
  { encoding: "utf-8" },
);

console.log("");
console.log("=== Nexora signed integrity manifest ===");
console.log(`  buildId    : ${BUILD_ID}`);
console.log(`  customerId : ${CUSTOMER_ID ?? "(none — generic build)"}`);
console.log(`  files      : ${rel.length}`);
console.log(`  signature  : ${signed.signature.slice(0, 32)}…`);
console.log(`  out        : ${OUT}`);
console.log("");
console.log("Ship this file alongside the Paid release. The integrity verifier");
console.log("at backend/src/lib/integrity.ts loads it on boot and fails closed");
console.log("(degraded mode) on any mismatch. See docs/SECURITY_ARCHITECTURE.md.");

// ─── Helpers ──────────────────────────────────────────────────────────────

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
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
    }
    return v;
  });
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
