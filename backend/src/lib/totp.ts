/**
 * TOTP (Time-based One-Time Password) — RFC 6238 minimal impl.
 * Crypto from Node built-ins only (no @noble/hashes complexity).
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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

export type VerifyResult = { ok: true; counter: number } | { ok: false; counter: -1 };

/**
 * Verify TOTP code (±1 window for clock skew) with replay protection.
 * Returns the matched RFC-6238 step on success so the caller can persist
 * `max(prev, matched)` and reject any code whose step is `<= lastCounter`.
 * Without this, a code observed once (shoulder-surf, screen-share, MITM
 * stripping a partial response) is replayable for ~60-90s — RFC 6238 §5.2
 * explicitly calls this out.
 *
 * Compares with timingSafeEqual instead of `===` so a remote attacker can't
 * use response-time differences to learn matching prefix length of the
 * 6-digit code. Trivial in absolute terms (1M code space) but free to fix.
 * Also normalizes the user's input — strip spaces, reject anything that
 * isn't exactly 6 digits — so a malformed code doesn't waste an HMAC pass.
 */
export function verifyCode(secret: string, code: string, lastCounter: number): VerifyResult {
  const clean = (code ?? "").replace(/\s+/g, "");
  if (clean.length !== DIGITS || !/^\d{6}$/.test(clean)) return { ok: false, counter: -1 };
  const key = decodeBase32(secret);
  if (key.length === 0) return { ok: false, counter: -1 };
  const now = Math.floor(Date.now() / 1000 / PERIOD);
  const userBuf = Buffer.from(clean, "utf8");
  // Always evaluate every offset (constant work) to avoid leaking which
  // window matched via early-return timing.
  let matched = -1;
  for (const offset of [-1, 0, 1]) {
    const counter = now + offset;
    const expected = hotp(key, counter).toString().padStart(DIGITS, "0");
    const expBuf = Buffer.from(expected, "utf8");
    if (expBuf.length === userBuf.length && timingSafeEqual(expBuf, userBuf)) {
      // Guard replay: a step <= lastCounter is a code that was already
      // accepted (or one from before the user's last successful verify).
      if (counter > lastCounter) matched = counter;
    }
  }
  return matched >= 0 ? { ok: true, counter: matched } : { ok: false, counter: -1 };
}

/** Format secret for display (groups of 4). */
export function formatSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/* ───────────────────────── backup codes ─────────────────────── */

// 32-char Crockford-ish alphabet — drops 0/O/1/I/L to avoid handwriting
// mistakes when an admin transcribes from a printed sheet. 10 chars from
// this alphabet ≈ 50 bits of entropy, well past online-brute-force range.
const BACKUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BACKUP_LENGTH = 10;
const BACKUP_COUNT = 8;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_LEN = 16;

/** Generate a fresh batch of 8 plaintext backup codes (10 chars each). */
export function generateBackupCodes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < BACKUP_COUNT; i++) {
    const buf = randomBytes(BACKUP_LENGTH);
    let s = "";
    for (const b of buf) s += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    out.push(s);
  }
  return out;
}

/** Hash plaintext backup codes for storage. Returns "saltHex:hashHex" entries. */
export function hashBackupCodes(plain: string[]): string[] {
  return plain.map((code) => {
    const salt = randomBytes(SCRYPT_SALT_LEN);
    const hash = scryptSync(normalizeBackup(code), salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
  });
}

/** Normalize user-typed backup codes: strip spaces/dashes, uppercase. */
function normalizeBackup(code: string): string {
  return (code ?? "").replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * Verify a candidate backup code against the stored "salt:hash" list and,
 * on match, return the new list with the consumed entry removed. Backup
 * codes are one-shot — reusing one would defeat the recovery-only intent.
 *
 * Iterates ALL hashes regardless of an early match so the time taken
 * doesn't leak how many codes are still unused.
 */
export function verifyAndConsumeBackupCode(
  candidate: string,
  hashes: string[],
): { ok: true; remaining: string[] } | { ok: false } {
  const norm = normalizeBackup(candidate);
  if (norm.length === 0) return { ok: false };
  let matchIdx = -1;
  for (let i = 0; i < hashes.length; i++) {
    const [saltHex, hashHex] = hashes[i].split(":");
    if (!saltHex || !hashHex) continue;
    let derived: Buffer;
    try {
      derived = scryptSync(norm, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      });
    } catch {
      continue;
    }
    const stored = Buffer.from(hashHex, "hex");
    if (stored.length === derived.length && timingSafeEqual(stored, derived) && matchIdx === -1) {
      matchIdx = i;
    }
  }
  if (matchIdx === -1) return { ok: false };
  const remaining = hashes.filter((_, i) => i !== matchIdx);
  return { ok: true, remaining };
}
