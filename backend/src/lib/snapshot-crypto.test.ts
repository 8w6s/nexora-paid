import { describe, expect, it } from "bun:test";
import { encryptSnapshot, decryptSnapshot, type KeyMaterial } from "./snapshot-crypto.ts";

const KM: KeyMaterial = {
  licenseSecret: "license-secret-which-is-long-enough-for-test",
  machineId: "machine-id-abc-1234",
};

describe("snapshot-crypto", () => {
  it("round-trips arbitrary bytes", () => {
    const plain = Buffer.from("hello nexora bi mat do");
    const enc = encryptSnapshot(plain, KM);
    expect(enc.length).toBeGreaterThan(plain.length);
    expect(enc.subarray(0, 4).toString("ascii")).toBe("NXS1");
    const out = decryptSnapshot(enc, KM);
    expect(out.equals(plain)).toBe(true);
  });

  it("decrypt fails when license-secret changes", () => {
    const enc = encryptSnapshot(Buffer.from("x"), KM);
    expect(() => decryptSnapshot(enc, { ...KM, licenseSecret: KM.licenseSecret + "tamper" })).toThrow();
  });

  it("decrypt fails when machine-id changes", () => {
    const enc = encryptSnapshot(Buffer.from("x"), KM);
    expect(() => decryptSnapshot(enc, { ...KM, machineId: "different-machine" })).toThrow();
  });

  it("decrypt fails when ciphertext is tampered", () => {
    const enc = encryptSnapshot(Buffer.from("hello"), KM);
    enc[20] ^= 0x01;
    expect(() => decryptSnapshot(enc, KM)).toThrow();
  });

  it("decrypt fails when auth tag is tampered", () => {
    const enc = encryptSnapshot(Buffer.from("hello"), KM);
    enc[enc.length - 1] ^= 0x01;
    expect(() => decryptSnapshot(enc, KM)).toThrow();
  });

  it("rejects files without the NXS1 magic", () => {
    const fake = Buffer.alloc(64, 0);
    expect(() => decryptSnapshot(fake, KM)).toThrow(/magic/);
  });

  it("rejects truncated files", () => {
    expect(() => decryptSnapshot(Buffer.alloc(4), KM)).toThrow();
  });

  it("rejects key material that is too short", () => {
    expect(() => encryptSnapshot(Buffer.from("x"), { licenseSecret: "short", machineId: KM.machineId })).toThrow();
    expect(() => encryptSnapshot(Buffer.from("x"), { licenseSecret: KM.licenseSecret, machineId: "x" })).toThrow();
  });

  it("produces different ciphertexts for same plaintext", () => {
    const a = encryptSnapshot(Buffer.from("same"), KM);
    const b = encryptSnapshot(Buffer.from("same"), KM);
    expect(a.equals(b)).toBe(false);
    expect(decryptSnapshot(a, KM).equals(decryptSnapshot(b, KM))).toBe(true);
  });
});