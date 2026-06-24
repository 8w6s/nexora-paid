/**
 * Snapshot file format (binary):
 *   magic     4B   "NXS1"
 *   nonce    12B   random per-snapshot
 *   ciphertext  N   AES-256-GCM of plaintext
 *   tag      16B   GCM auth tag (appended by encrypt())
 *
 * Key derivation:
 *   key = HKDF-SHA256(
 *     ikm  = license-secret || machine-id,
 *     salt = "nexora-snapshot-v1",
 *     info = "snapshot-key",
 *     len  = 32,
 *   )
 *
 * Why both license-secret AND machine-id?
 * - license-secret alone: copying snapshot + license to a fresh host still decrypts.
 * - machine-id alone: re-issuing license would not invalidate old snapshots.
 * - Together: snapshot is bound to the exact (customer, machine) pair. Moving
 *   either invalidates the snapshot — the recovery path is to ask us, the
 *   license issuer, to re-derive on the new machine.
 *
 * Where machine-id comes from:
 * - Linux: /etc/machine-id (existing systemd convention).
 * - In our container: we bind-mount or persist a UUID inside the data volume
 *   on first boot — see ensureMachineId() in lib/tenant.ts (next commit).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("NXS1", "ascii");
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SALT = Buffer.from("nexora-snapshot-v1", "ascii");
const INFO = Buffer.from("snapshot-key", "ascii");

export interface KeyMaterial {
  licenseSecret: string;
  machineId: string;
}

function deriveKey(km: KeyMaterial): Buffer {
  if (!km.licenseSecret || km.licenseSecret.length < 16) {
    throw new Error("license-secret missing or too short");
  }
  if (!km.machineId || km.machineId.length < 8) {
    throw new Error("machine-id missing or too short");
  }
  const ikm = Buffer.concat([Buffer.from(km.licenseSecret, "utf8"), Buffer.from(km.machineId, "utf8")]);
  const out = hkdfSync("sha256", ikm, SALT, INFO, KEY_LEN);
  return Buffer.from(out);
}

export function encryptSnapshot(plaintext: Buffer, km: KeyMaterial): Buffer {
  const key = deriveKey(km);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, nonce, ct, tag]);
}

export function decryptSnapshot(file: Buffer, km: KeyMaterial): Buffer {
  if (file.length < MAGIC.length + NONCE_LEN + TAG_LEN) {
    throw new Error("snapshot too short / not a NXS1 file");
  }
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("snapshot magic mismatch (not a NXS1 file)");
  }
  const nonce = file.subarray(MAGIC.length, MAGIC.length + NONCE_LEN);
  const tag = file.subarray(file.length - TAG_LEN);
  const ct = file.subarray(MAGIC.length + NONCE_LEN, file.length - TAG_LEN);
  const key = deriveKey(km);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  // throws on tag mismatch — wrong key, wrong machine, or tampering.
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Streaming API for large snapshots — avoid loading the whole tar in memory. */
export function createSnapshotEncryptor(km: KeyMaterial): {
  header: Buffer;
  cipher: import("node:crypto").CipherGCM;
  finalize(): Buffer;
} {
  const key = deriveKey(km);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  return {
    header: Buffer.concat([MAGIC, nonce]),
    cipher,
    finalize() {
      const finalBlock = cipher.final();
      const tag = cipher.getAuthTag();
      return Buffer.concat([finalBlock, tag]);
    },
  };
}