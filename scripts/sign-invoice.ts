#!/usr/bin/env bun
/**
 * Sign a per-customer invoice record with the same ed25519 key used for
 * the version manifest + license bundle.
 *
 * Drop the output at `nexora-releases/invoices/<invoiceId>.json` (private
 * repo). The backend baked with `NEXORA_INVOICE_ID=<invoiceId>` will fetch
 * that file at boot + every 24h, verify the signature, and gate paid
 * features by `status`.
 *
 * Usage:
 *   bun run scripts/sign-invoice.ts \
 *     --id=inv_2026_001 \
 *     --email=customer@example.com \
 *     [--status=active]                   # active | revoked | suspended
 *     [--expires=2027-12-31T23:59:59Z]    # ISO; absent = lifetime
 *     [--features=search-suggest,admin-bulk,admin-export,admin-customers-csv]
 *     [--note="lifetime, paid 2026-06-27"]
 *     [--out=./issued/inv_2026_001.json]
 *
 * Status values:
 *   active     paid features enabled (default)
 *   revoked    chargeback / leaked → paid features disabled, banner red
 *   suspended  manual hold (non-payment) → paid features disabled, banner amber
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

const VALID_STATUS = new Set(["active", "revoked", "suspended"]);

interface InvoicePayload {
  invoiceId: string;
  email: string;
  status: "active" | "revoked" | "suspended";
  issuedAt: string;
  productId: "nexora-paid";
  expiresAt?: string;
  features?: string[];
  note?: string;
}

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
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) throw new Error("malformed hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const args = parseArgs(process.argv.slice(2));
if (!args.id || !args.email) {
  console.error(
    "Usage: bun run scripts/sign-invoice.ts --id=inv_2026_001 --email=customer@example.com [--status=active] [--expires=ISO] [--features=a,b] [--note=...] [--out=...]",
  );
  process.exit(1);
}

const status = (args.status ?? "active").toLowerCase();
if (!VALID_STATUS.has(status)) {
  console.error(`Invalid --status: ${status} (allowed: ${[...VALID_STATUS].join(", ")})`);
  process.exit(1);
}

const idShape = /^[a-zA-Z0-9._-]{4,64}$/;
if (!idShape.test(args.id)) {
  console.error(`Invalid --id: must match ${idShape}`);
  process.exit(1);
}

const PRIV_PATH = resolve(process.cwd(), ".keys/license-signer.private");
if (!existsSync(PRIV_PATH)) {
  console.error(`!! No signing key at ${PRIV_PATH}.`);
  console.error(`!! Run: bun run scripts/gen-keypair.ts first.`);
  process.exit(1);
}
const priv = hexToBytes(readFileSync(PRIV_PATH, "utf8").trim());

const features = args.features
  ? args.features
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : undefined;

const payload: InvoicePayload = {
  invoiceId: args.id,
  email: args.email.trim().toLowerCase(),
  status: status as InvoicePayload["status"],
  issuedAt: new Date().toISOString(),
  productId: "nexora-paid",
  ...(args.expires ? { expiresAt: args.expires } : {}),
  ...(features && features.length ? { features } : {}),
  ...(args.note ? { note: args.note } : {}),
};

const canonical = canonicalize(payload);
const sig = await ed.sign(new TextEncoder().encode(canonical), priv);

const out = { payload, signature: bytesToHex(sig) };
const outPath = resolve(process.cwd(), args.out ?? `./issued/${payload.invoiceId}.json`);
try {
  mkdirSync(dirname(outPath), { recursive: true });
} catch (e: unknown) {
  if ((e as { code?: string })?.code !== "EEXIST") throw e;
}
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

console.log(`\n✓ Invoice record signed`);
console.log(`  ID:       ${payload.invoiceId}`);
console.log(`  Email:    ${payload.email}`);
console.log(`  Status:   ${payload.status}`);
if (payload.expiresAt) console.log(`  Expires:  ${payload.expiresAt}`);
if (payload.features) console.log(`  Features: ${payload.features.join(", ")}`);
console.log(`  → ${outPath}`);
console.log(`\nNext: commit this file to nexora-releases/invoices/${payload.invoiceId}.json`);
console.log(`Then dispatch the customer-build workflow with invoice_id=${payload.invoiceId}.\n`);