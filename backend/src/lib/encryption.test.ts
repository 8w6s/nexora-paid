import { describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decrypt, encrypt } from "./encryption.ts";

describe("Database Column Encryption", () => {
  test("should encrypt and decrypt correctly", () => {
    const rawText = "SuperSecretBitcoinXpubKey123456";
    const cipherText = encrypt(rawText);

    expect(cipherText).not.toBe(rawText);
    expect(cipherText.split(":").length).toBe(3); // iv:authTag:ciphertext

    const decryptedText = decrypt(cipherText);
    expect(decryptedText).toBe(rawText);
  });

  test("should handle raw plain text gracefully (fallback for legacy records)", () => {
    const legacyText = "NormalUnencryptedText";
    const decrypted = decrypt(legacyText);
    expect(decrypted).toBe(legacyText);
  });

  test("should generate persistent key file if no env key is set", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const keyPath = join(currentDir, "..", "..", "..", ".keys", "db_encryption.key");

    // The key should have been created during the first test
    expect(existsSync(keyPath)).toBe(true);
  });

  test("should produce different ciphertexts for the same plaintext due to random IVs", () => {
    const text = "SameInputText";
    const cipher1 = encrypt(text);
    const cipher2 = encrypt(text);

    expect(cipher1).not.toBe(cipher2);
    expect(decrypt(cipher1)).toBe(text);
    expect(decrypt(cipher2)).toBe(text);
  });
});
