#!/usr/bin/env bun
/**
 * Add a customer line to `customers.txt` in encrypted form.
 *
 * The plain `email:invoice_id` is encrypted with AES-256-GCM using the
 * shared key NEXORA_CUSTOMERS_KEY (32 bytes hex, kept in the repo's
 * secret store + the workflow runner). The output is a single base64
 * line that auto-build.yml decrypts at CI time.
 *
 * Usage:
 *   NEXORA_CUSTOMERS_KEY=<64 hex> \
 *     bun run scripts/add-customer.ts --email=customer@example.com --invoice=inv_2026_001
 *
 * Output (paste this line into customers.txt on nexora-releases):
 *
 *   nx1:<base64 ciphertext>
 *
 * The "nx1:" prefix is a version marker so future schema changes can
 * coexist; older nx1: lines keep working until you rotate the key.
 *
 * Key generation (one-time, on a trusted host):
 *
 *   openssl rand -hex 32
 *
 * Set the resulting hex string as the NEXORA_CUSTOMERS_KEY secret on
 * BOTH repos (nexora-paid + nexora-releases) and keep a copy in your
 * password manager. Anyone with the key can read every customer entry.
 */
import { createCipheriv, randomBytes } from "node:crypto";

const ID_SHAPE = /^[A-Za-z0-9._-]{4,64}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const args = parseArgs(process.argv.slice(2));
const email = (args.email ?? "").trim().toLowerCase();
const invoice = (args.invoice ?? "").trim();

if (!email || !invoice) {
  console.error("Usage: bun run scripts/add-customer.ts --email=customer@example.com --invoice=inv_2026_001");
  process.exit(1);
}
if (!EMAIL_SHAPE.test(email)) {
  console.error(`Invalid --email: ${email}`);
  process.exit(1);
}
if (!ID_SHAPE.test(invoice)) {
  console.error(`Invalid --invoice: ${invoice} (allowed: [A-Za-z0-9._-]{4,64})`);
  process.exit(1);
}

const keyHex = (process.env.NEXORA_CUSTOMERS_KEY ?? "").trim();
if (!keyHex) {
  console.error("NEXORA_CUSTOMERS_KEY missing. Generate it once with: openssl rand -hex 32");
  console.error("Then kep it as a secret on both repos (nexora-paid + nexora-releases).");
  process.exit(1);
}
if (keyHex.length !== 64) {
  console.error(`NEXORA_CUSTOMERS_KEY must be 64 hex chars (got ${keyHex.length})`);
  process.exit(1);
}
const key = Buffer.from(keyHex, "hex");
if (key.length !== 32) {
  console.error("NEXORA_CUSTOMERS_KEY must decode to exactly 32 bytes");
  process.exit(1);
}

const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const plaintext = Buffer.from(`${email}:${invoice}`, "utf8");
const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

// Layout: iv (12) | tag (16) | ciphertext (n). Single base64 blob.
const blob = Buffer.concat([iv, tag, ct]).toString("base64");
const line = `nx1:${blob}`;

console.log("\nPaste the line below as-is into nexora-releases/customers.txt:\n");
console.log(line);
console.log(`\nDecrypts to: ${email}:${invoice}\n`);