/**
 * TOTP (Time-based One-Time Password) — RFC 6238 minimal impl.
 * Crypto from Node built-ins only (no @noble/hashes complexity).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const PERIOD = 30; // seconds
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate 160-bit random secret (Base32-encoded, 32 chars). */
export function generateSecret(): string {
  const buf = randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += B32[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decode Base32 to bytes. */
function decodeBase32(input: string): Buffer {
  const clean = input.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = B32.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** HOTP counter-based OTP. */
function hotp(secret: Buffer, counter: number): number {
  const msg = Buffer.alloc(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  const hash = createHmac("sha1", secret).update(msg).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return code % 10 ** DIGITS;
}

/** Current TOTP code for secret. */
export function generateCode(secret: string): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  return hotp(key, counter).toString().padStart(DIGITS, "0");
}

/**
 * Verify TOTP code (±1 window for clock skew).
 *
 * Compares with timingSafeEqual instead of `===` so a remote attacker can't
 * use response-time differences to learn matching prefix length of the
 * 6-digit code. Trivial in absolute terms (1M code space) but free to fix.
 * Also normalizes the user's input — strip spaces, reject anything that
 * isn't exactly 6 digits — so a malformed code doesn't waste an HMAC pass.
 */
export function verifyCode(secret: string, code: string): boolean {
  const clean = (code ?? "").replace(/\s+/g, "");
  if (clean.length !== DIGITS || !/^\d{6}$/.test(clean)) return false;
  const key = decodeBase32(secret);
  if (key.length === 0) return false;
  const now = Math.floor(Date.now() / 1000 / PERIOD);
  const userBuf = Buffer.from(clean, "utf8");
  let ok = false;
  for (const offset of [-1, 0, 1]) {
    const expected = hotp(key, now + offset)
      .toString()
      .padStart(DIGITS, "0");
    const expBuf = Buffer.from(expected, "utf8");
    if (expBuf.length === userBuf.length && timingSafeEqual(expBuf, userBuf)) ok = true;
  }
  return ok;
}

/** Format secret for display (groups of 4). */
export function formatSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}
