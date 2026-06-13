import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

let encryptionKey: Buffer | null = null;

/**
 * Resolves the database encryption key from environment or local key file.
 * Automatically generates a secure 32-byte key if none is found.
 */
function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  // 1. Try env variable first
  const envKey = process.env.DATABASE_ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      // Hex representation of 32 bytes
      encryptionKey = Buffer.from(envKey, "hex");
      return encryptionKey;
    }
    // Fallback to hashing the env key if it's not a 64-char hex string
    encryptionKey = createCipheriv ? Buffer.from(envKey.padEnd(32).slice(0, 32)) : Buffer.alloc(32);
    // Let's use a SHA256 of the string to ensure a solid 32-byte buffer
    const { createHash } = require("node:crypto");
    encryptionKey = createHash("sha256").update(envKey).digest();
    return encryptionKey;
  }

  // 2. Try reading from .keys directory
  // Find project root `.keys` directory
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const keysDir = join(currentDir, "..", "..", "..", ".keys");
  const keyPath = join(keysDir, "db_encryption.key");

  try {
    if (!existsSync(keysDir)) {
      mkdirSync(keysDir, { recursive: true });
    }

    if (existsSync(keyPath)) {
      const savedKey = readFileSync(keyPath, "utf8").trim();
      encryptionKey = Buffer.from(savedKey, "hex");
      if (encryptionKey.length === 32) {
        return encryptionKey;
      }
    }

    // 3. Auto-generate a secure random key
    const newKey = randomBytes(32);
    writeFileSync(keyPath, newKey.toString("hex"), "utf8");
    encryptionKey = newKey;
    return encryptionKey;
  } catch (error) {
    // Ultimate fallback (not recommended for production, but prevents crashes)
    console.error(
      "Failed to load or generate database encryption key, using ephemeral fallback key:",
      error,
    );
    encryptionKey = randomBytes(32);
    return encryptionKey;
  }
}

/**
 * Encrypts clear text using AES-256-GCM.
 * Output format: iv_hex:auth_tag_hex:ciphertext_hex
 */
export function encrypt(text: string): string {
  try {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error("Encryption failed");
  }
}

/**
 * Decrypts cipher text encoded in iv_hex:auth_tag_hex:ciphertext_hex format.
 * Returns the original string.
 */
export function decrypt(cipherText: string): string {
  if (!cipherText) return cipherText;

  // If the string doesn't match our format, return it as-is (e.g., pre-existing unencrypted data)
  const parts = cipherText.split(":");
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) {
    return cipherText;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encryptedText = Buffer.from(parts[2], "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    // If decryption fails, return as-is (handles cases where we transition from plain-text to encrypted)
    console.error("Decryption failed, returning raw value:", error);
    return cipherText;
  }
}
