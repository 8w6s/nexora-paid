import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let encryptionKey: Buffer | null = null;

/**
 * Resolves the AES-256-GCM master key for encrypted DB columns.
 *
 * Resolution order:
 *   1. `DATABASE_ENCRYPTION_KEY` env. Production REQUIRES 64-char hex (32 raw
 *      bytes). Dev allows a sha256 fallback so a passphrase still produces a
 *      32-byte key during local iteration.
 *   2. `.keys/db_encryption.key` on disk — auto-generated on first boot in dev.
 *
 * In production (`NODE_ENV=production`) we refuse to silently generate an
 * ephemeral random key: that would re-encrypt new rows under a key that dies
 * with the process, leaving every existing encrypted column undecryptable
 * after the next restart. Dev keeps the auto-generate convenience.
 */
function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  const isProd = process.env.NODE_ENV === "production";
  const envKey = process.env.DATABASE_ENCRYPTION_KEY;

  if (envKey) {
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      encryptionKey = Buffer.from(envKey, "hex");
      return encryptionKey;
    }
    if (isProd) {
      throw new Error(
        "DATABASE_ENCRYPTION_KEY must be 64 hex chars (32 raw bytes) in production. " +
          "Generate one with `openssl rand -hex 32`. Refusing to derive an AES key " +
          "from a passphrase via sha256 fallback.",
      );
    }
    encryptionKey = createHash("sha256").update(envKey).digest();
    return encryptionKey;
  }

  // Resolve .keys relative to the app root (/app in Docker, or repo root locally).
  // In Docker the working directory is /app; locally it varies, so we derive
  // from the source file path: src/lib/encryption.ts → ../../ = backend/ → ../ = repo root.
  // However in Docker the backend IS the root, so we go up to /app.
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const appRoot = join(currentDir, "..", ".."); // /app/src/lib → /app
  const keysDir = join(appRoot, ".keys");
  const keyPath = join(keysDir, "db_encryption.key");

  try {
    if (existsSync(keyPath)) {
      const savedKey = readFileSync(keyPath, "utf8").trim();
      const buf = Buffer.from(savedKey, "hex");
      if (buf.length === 32) {
        encryptionKey = buf;
        return encryptionKey;
      }
      throw new Error(
        `${keyPath} exists but is not a valid 32-byte hex key (got ${buf.length} bytes).`,
      );
    }

    if (isProd) {
      throw new Error(
        "DATABASE_ENCRYPTION_KEY not set and no .keys/db_encryption.key found in production. " +
          "Generate one with `openssl rand -hex 32` and set DATABASE_ENCRYPTION_KEY, " +
          "or mount a persistent .keys directory.",
      );
    }

    if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true });
    const newKey = randomBytes(32);
    writeFileSync(keyPath, newKey.toString("hex"), "utf8");
    console.warn(
      `[encryption] Generated new dev key at ${keyPath}. Set DATABASE_ENCRYPTION_KEY in production.`,
    );
    encryptionKey = newKey;
    return encryptionKey;
  } catch (error) {
    if (isProd) throw error;
    console.error("[encryption] dev fallback to ephemeral key:", error);
    encryptionKey = randomBytes(32);
    return encryptionKey;
  }
}

/**
 * Encrypts clear text using AES-256-GCM.
 * Output format: `iv_hex:auth_tag_hex:ciphertext_hex`.
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts cipher text encoded in `iv_hex:auth_tag_hex:ciphertext_hex`.
 *
 * Strings that don't match the encrypted column shape are returned as-is —
 * this covers pre-encryption legacy rows. Strings that DO match the shape
 * but fail GCM auth throw — silently returning ciphertext was the v1
 * behavior and made tamper detection impossible.
 */
export function decrypt(cipherText: string): string {
  if (!cipherText) return cipherText;

  const parts = cipherText.split(":");
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) {
    return cipherText;
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encryptedText = Buffer.from(parts[2], "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, undefined, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}