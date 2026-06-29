/**
 * Crypto primitives used by the Worker.
 *
 * Browser/Worker-native: SubtleCrypto for HMAC + AES-GCM, @noble/ed25519
 * (pure JS) for license signing. No node:crypto.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

const enc = new TextEncoder();

// Cloudflare's WebCrypto types want ArrayBuffer (not ArrayBufferLike).
// Wrap Uint8Array views so we never hand SubtleCrypto a SharedArrayBuffer view.
function ab(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error(`bad hex at offset ${i * 2}`);
    out[i] = b;
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function bytesToBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256(secret, body) → hex.
 */
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ab(enc.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, ab(enc.encode(body)));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Accept "<hex>", "sha256=<hex>", "v1=<hex>", or Stripe-style "t=...,v1=<hex>".
 */
export async function verifyHmacSignature(
  secret: string,
  body: string,
  header: string,
): Promise<boolean> {
  if (!header) return false;
  const cleaned = header
    .split(",")
    .map((s) => s.trim())
    .map((s) => (s.includes("=") ? s.split("=").slice(-1)[0] : s))
    .find((s) => /^[0-9a-f]{64}$/i.test(s));
  if (!cleaned) return false;
  const expected = await hmacSha256Hex(secret, body);
  return timingSafeEqualHex(expected.toLowerCase(), cleaned.toLowerCase());
}

/**
 * AES-256-GCM encrypt → `nx1:<base64(iv || ciphertext || tag)>`.
 * Matches scripts/add-customer.ts format so auto-build.yml's decryptor
 * accepts our lines verbatim.
 */
export async function encryptCustomerLine(
  plaintext: string,
  keyHex: string,
): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) throw new Error("customers key must be 32 bytes");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ab(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ctTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ab(iv) },
      cryptoKey,
      ab(enc.encode(plaintext)),
    ),
  );
  const out = new Uint8Array(iv.length + ctTag.length);
  out.set(iv, 0);
  out.set(ctTag, iv.length);
  return `nx1:${bytesToBase64(out)}`;
}

/**
 * Ed25519 sign over JSON.stringify(payload).
 * Compatible with scripts/sign-license.ts + backend/src/lib/license.ts.
 */
export async function signLicensePayload(
  payload: Record<string, unknown>,
  privKeyHex: string,
): Promise<string> {
  const priv = hexToBytes(privKeyHex);
  if (priv.length !== 32) throw new Error("ed25519 private key must be 32 bytes");
  const msg = enc.encode(JSON.stringify(payload));
  const sig = await ed.sign(msg, priv);
  return bytesToHex(sig);
}