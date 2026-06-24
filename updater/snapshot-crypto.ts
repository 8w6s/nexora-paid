/**
 * Mirror of backend/src/lib/snapshot-crypto.ts. Updater encrypts snapshots
 * in-place after `tar` produces the plaintext .tar.gz inside the backup dir.
 * Key material is supplied by the backend in the /apply body (HMAC-protected).
 */
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, renameSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("NXS1", "ascii");
const NONCE_LEN = 12;
const KEY_LEN = 32;
const SALT = Buffer.from("nexora-snapshot-v1", "ascii");
const INFO = Buffer.from("snapshot-key", "ascii");

export interface KeyMaterial {
  licenseSecret: string;
  machineId: string;
}

function deriveKey(km: KeyMaterial): Buffer {
  if (!km.licenseSecret || km.licenseSecret.length < 16) throw new Error("license-secret missing");
  if (!km.machineId || km.machineId.length < 8) throw new Error("machine-id missing");
  const ikm = Buffer.concat([Buffer.from(km.licenseSecret, "utf8"), Buffer.from(km.machineId, "utf8")]);
  return Buffer.from(hkdfSync("sha256", ikm, SALT, INFO, KEY_LEN));
}

export async function encryptFileInPlace(plainPath: string, encPath: string, km: KeyMaterial): Promise<void> {
  const key = deriveKey(km);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const src = createReadStream(plainPath);
  const tmp = `${encPath}.partial`;
  const dst = createWriteStream(tmp);
  dst.write(MAGIC);
  dst.write(nonce);
  await pipeline(src, cipher, dst, { end: false });
  dst.write(cipher.getAuthTag());
  await new Promise<void>((res, rej) => dst.end((err?: Error | null) => (err ? rej(err) : res())));
  renameSync(tmp, encPath);
  try { unlinkSync(plainPath); } catch { /* ignore */ }
  // Zero the key buffer so it doesn't linger in heap longer than needed.
  key.fill(0);
}