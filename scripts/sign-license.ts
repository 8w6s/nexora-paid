#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
/**
 * Issue (sign) a `.license` file for a Nexora Paid customer.
 *
 * Run by the maintainer on the dev machine that holds the private key.
 * Reads .keys/license-signer.private (created by gen-keypair.ts) and
 * writes a portable JSON file the customer drops next to their Nexora
 * install. The customer's app verifies the signature with the embedded
 * public key at boot.
 *
 * Usage:
 *   bun run scripts/sign-license.ts --email=customer@example.com [--note=v1]
 *   bun run scripts/sign-license.ts --email=foo@bar.com --out=./issued/foo.license
 *
 * Defaults:
 *   --product   nexora
 *   --out       ./issued/<sanitized-email>.license
 *   --note      (empty)
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// @noble/ed25519 v3 requires a sync sha512 implementation to be registered.
ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

const args = parseArgs(process.argv.slice(2));
if (!args.email) {
  console.error(
    "Usage: bun run scripts/sign-license.ts --email=customer@example.com [--customer=cus_123] [--ttl=365] [--expires=2027-12-31T23:59:59Z] [--features=search-suggest,admin-bulk,admin-export,admin-customers-csv] [--product=nexora-paid] [--note=v1] [--out=./issued/x.license]",
  );
  process.exit(1);
}

const PRIV_PATH = resolve(process.cwd(), ".keys/license-signer.private");
if (!existsSync(PRIV_PATH)) {
  console.error(`!! No signing key at ${PRIV_PATH}.`);
  console.error(`!! Run: bun run scripts/gen-keypair.ts first.`);
  process.exit(1);
}
const privHex = readFileSync(PRIV_PATH, "utf-8").trim();
const privBytes = hexToBytes(privHex);

const ttlDays = args.ttl ? Number(args.ttl) : NaN;
const expiresAt =
  Number.isFinite(ttlDays) && ttlDays > 0
    ? new Date(Date.now() + ttlDays * 86_400_000).toISOString()
    : args.expires;
const features = args.features
  ? args.features
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : undefined;

const payload = {
  email: args.email.trim().toLowerCase(),
  productId: args.product ?? "nexora-paid",
  issuedAt: new Date().toISOString(),
  ...(args.note ? { note: args.note } : {}),
  ...(args.customer ? { customerId: args.customer } : {}),
  ...(expiresAt ? { expiresAt } : {}),
  ...(features && features.length ? { features } : {}),
};

const msg = new TextEncoder().encode(JSON.stringify(payload));
const sig = await ed.sign(msg, privBytes);
const pubBytes = await ed.getPublicKey(privBytes);

const signedLicense = {
  payload,
  signature: bytesToHex(sig),
};

const outPath = resolve(
  process.cwd(),
  args.out ?? `./issued/${payload.email.replace(/[^a-z0-9]/g, "_")}.license`,
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(signedLicense, null, 2));

console.log(`\n✓ License signed for ${payload.email}`);
console.log(`  Product:  ${payload.productId}`);
console.log(`  Issued:   ${payload.issuedAt}`);
if (payload.customerId) console.log(`  Customer: ${payload.customerId}`);
if (payload.expiresAt) console.log(`  Expires:  ${payload.expiresAt}`);
if (payload.features) console.log(`  Features: ${payload.features.join(", ")}`);
if (payload.note) console.log(`  Note:     ${payload.note}`);
console.log(`  → ${outPath}`);
console.log(`\nSend the file above to the customer; they drop it as`);
console.log(`  ./nexora.license  (or set LICENSE_FILE=/abs/path)`);
console.log(`next to the Nexora Paid install. Verify with:`);
console.log(`  Public key fingerprint: ${bytesToHex(pubBytes).slice(0, 16)}…\n`);

/* ─── helpers ─── */

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = "true";
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
