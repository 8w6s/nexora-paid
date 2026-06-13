/**
 * Offline ed25519 license verification.
 *
 * Architecture:
 *  - The maintainer holds a private signing key (NEVER shipped, NEVER
 *    committed — it lives only on their dev machine).
 *  - Every Paid build embeds the matching public key as raw 32 bytes hex
 *    in `LICENSE_PUBKEY_HEX` below. Replace the placeholder during the
 *    first real release.
 *  - On boot, the Paid app reads a `.license` file next to the binary
 *    (or at `LICENSE_FILE` env path), parses the signed JSON inside, and
 *    verifies the signature with the embedded public key. Pass → enable
 *    paid modules. Fail → log + downgrade silently to Free behavior.
 *  - No network. No DB. No server-side activation count. One-time pay
 *    customers can install on as many machines as they need; we trust the
 *    license file itself.
 *
 * Anti-leak watermark:
 *  - The licensee's email is part of the signed payload — if a license
 *    file ever surfaces publicly we know exactly who leaked.
 *  - The Paid bundle additionally embeds (at build time) the buyer email
 *    string in a console banner, so even a stripped license file isn't
 *    enough to anonymize a leak.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// @noble/ed25519 v3 requires a sync sha512 implementation to be registered
// before any verify/sign call. We wire @noble/hashes once at import time.
if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

/**
 * PUBLIC KEY (hex, 32 bytes / 64 hex chars).
 *
 * Replace with the real public key emitted by `scripts/gen-keypair.ts` on
 * the maintainer's machine. The all-zero placeholder below makes every
 * signature fail closed — Paid modules stay locked until a real key is
 * shipped, which is the safe default during development.
 */
const LICENSE_PUBKEY_HEX = "b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3";

export interface LicensePayload {
  /** Buyer email (also watermarks the license file) */
  email: string;
  /** Product SKU — must match for the license to apply, e.g. "nexora" */
  productId: string;
  /** ISO timestamp of issuance — informational, not enforced (one-time pay) */
  issuedAt: string;
  /** Optional human note ("v1", "lifetime", customer ref…) */
  note?: string;
}

export interface SignedLicense {
  payload: LicensePayload;
  /** ed25519 signature over `JSON.stringify(payload)` (UTF-8 bytes), hex */
  signature: string;
}

export type VerifyResult =
  | { valid: true; email: string; payload: LicensePayload }
  | { valid: false; reason: string };

/**
 * Default lookup paths (in priority order):
 *   1. LICENSE_FILE env (absolute or relative)
 *   2. ./nexora.license   (cwd)
 *   3. ../nexora.license  (project root when backend is run from backend/)
 * Returns the first one that exists, or path #2 (for error messaging).
 */
function licenseFilePath(): string {
  if (Bun.env.LICENSE_FILE) return resolve(Bun.env.LICENSE_FILE);
  const candidates = [
    resolve(process.cwd(), "nexora.license"),
    resolve(process.cwd(), "..", "nexora.license"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[0];
}

/**
 * Read + verify the license. Returns {valid:false, reason} on any error;
 * never throws. The boot loader uses this to decide whether to register
 * paid modules.
 */
export async function verifyLicense(): Promise<VerifyResult> {
  const path = licenseFilePath();
  if (!existsSync(path)) return { valid: false, reason: `no license file at ${path}` };

  let signed: SignedLicense;
  try {
    const raw = readFileSync(path, "utf-8");
    signed = JSON.parse(raw);
  } catch (e) {
    return { valid: false, reason: `cannot parse license: ${e instanceof Error ? e.message : e}` };
  }
  if (!signed?.payload || !signed.signature) return { valid: false, reason: "malformed license (missing payload/signature)" };
  if (typeof signed.payload.email !== "string" || typeof signed.payload.productId !== "string") {
    return { valid: false, reason: "malformed payload (email/productId)" };
  }
  if (signed.payload.productId !== "nexora") {
    return { valid: false, reason: `wrong productId: ${signed.payload.productId}` };
  }
  if (LICENSE_PUBKEY_HEX === "00".repeat(32)) {
    return { valid: false, reason: "no public key embedded in build (placeholder still in license.ts)" };
  }

  // ed25519 signs the canonical JSON of payload — buyer email + productId
  // + issuedAt are the only fields ever signed.
  const msg = new TextEncoder().encode(JSON.stringify(signed.payload));
  let sigBytes: Uint8Array, pubBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(signed.signature);
    pubBytes = hexToBytes(LICENSE_PUBKEY_HEX);
  } catch (e) {
    return { valid: false, reason: `bad hex encoding: ${e instanceof Error ? e.message : e}` };
  }

  let ok = false;
  try {
    ok = await ed.verify(sigBytes, msg, pubBytes);
  } catch (e) {
    return { valid: false, reason: `signature verify error: ${e instanceof Error ? e.message : e}` };
  }
  if (!ok) return { valid: false, reason: "signature mismatch" };
  return { valid: true, email: signed.payload.email, payload: signed.payload };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error(`bad hex at offset ${i * 2}`);
    out[i] = b;
  }
  return out;
}
