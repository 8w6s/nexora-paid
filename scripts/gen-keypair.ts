#!/usr/bin/env bun
/**
 * Generate a fresh ed25519 keypair for license signing.
 *
 * Run ONCE per release product. The private key signs every `.license`
 * file the maintainer issues; the public key is embedded into the Paid
 * build's `backend/src/lib/license.ts` so customers can verify offline.
 *
 *   bun run scripts/gen-keypair.ts
 *
 * Output:
 *   - prints both keys (hex) to stdout
 *   - writes private key to .keys/license-signer.private (gitignored)
 *   - writes public key to .keys/license-signer.public (safe to share)
 *
 * After generating, paste the public-key hex into LICENSE_PUBKEY_HEX in
 * backend/src/lib/license.ts and rebuild. NEVER commit the private key.
 * If the private key leaks, every future license you sign is forgeable —
 * rotate by generating a new pair + rebuilding (existing licenses break).
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// @noble/ed25519 v3 requires a sync sha512 implementation to be registered.
ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

const KEYS_DIR = resolve(process.cwd(), ".keys");
const PRIV_PATH = join(KEYS_DIR, "license-signer.private");
const PUB_PATH = join(KEYS_DIR, "license-signer.public");

if (existsSync(PRIV_PATH)) {
  console.error(`\n!! Refusing to overwrite existing key at ${PRIV_PATH}`);
  console.error(`!! If you REALLY want to rotate, delete that file first.`);
  console.error(`!! (Rotation invalidates every license signed with the old key.)\n`);
  process.exit(1);
}

mkdirSync(KEYS_DIR, { recursive: true });

const privKey = ed.utils.randomSecretKey();
const pubKey = await ed.getPublicKey(privKey);

const privHex = bytesToHex(privKey);
const pubHex = bytesToHex(pubKey);

writeFileSync(PRIV_PATH, privHex + "\n", { mode: 0o600 });
writeFileSync(PUB_PATH, pubHex + "\n");

console.log("\n=== Nexora license keypair (ed25519) ===\n");
console.log(`Private key (32 bytes hex) → ${PRIV_PATH}`);
console.log(`  ${privHex}`);
console.log(`\nPublic key (32 bytes hex) → ${PUB_PATH}`);
console.log(`  ${pubHex}\n`);
console.log("Next steps:");
console.log("  1. Paste the PUBLIC key hex into LICENSE_PUBKEY_HEX in");
console.log("     backend/src/lib/license.ts and commit (public key is safe).");
console.log("  2. BACK UP the private key off-machine (password manager, hardware key).");
console.log("  3. Add .keys/ to .gitignore (already done by default).");
console.log("  4. Issue licenses with: bun run scripts/sign-license.ts --email=...\n");

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
