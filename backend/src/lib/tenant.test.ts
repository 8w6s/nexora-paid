import { describe, expect, it, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "nexora-tenant-"));
process.env.NEXORA_DATA_ROOT = tmp;

let mod: typeof import("./tenant.ts");
beforeAll(async () => {
  mod = await import("./tenant.ts");
});

describe("tenant jail", () => {
  it("resolves a clean relative path inside userspace", () => {
    const p = mod.jailUserspace("uploads/a.png");
    expect(p.startsWith(mod.USERSPACE_ROOT + sep)).toBe(true);
  });

  it("strips leading slashes (treats as relative)", () => {
    const p = mod.jailUserspace("/uploads/a.png");
    expect(p.startsWith(mod.USERSPACE_ROOT + sep)).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(() => mod.jailUserspace("../etc/passwd")).toThrow(/escapes/);
  });

  it("rejects deep traversal", () => {
    expect(() => mod.jailUserspace("uploads/../../etc/passwd")).toThrow(/escapes/);
  });

  it("rejects null bytes", () => {
    expect(() => mod.jailUserspace("uploads/\0passwd")).toThrow(/null byte/);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error testing runtime guard
    expect(() => mod.jailUserspace(undefined)).toThrow();
  });

  it("app jail is separate from userspace jail", () => {
    const a = mod.jailApp("secrets/key");
    expect(a.startsWith(mod.APP_ROOT + sep)).toBe(true);
    expect(a.startsWith(mod.USERSPACE_ROOT + sep)).toBe(false);
  });

  it("ensureMachineId is stable across calls", () => {
    const a = mod.ensureMachineId();
    const b = mod.ensureMachineId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it("readLicenseSecret pulls from license.lic signature field", () => {
    writeFileSync(join(mod.APP_ROOT, "license.lic"), JSON.stringify({ signature: "x".repeat(64) }));
    delete process.env.NEXORA_LICENSE_SECRET;
    const sec = mod.readLicenseSecret();
    expect(sec.length).toBe(64);
  });

  it("readLicenseSecret prefers NEXORA_LICENSE_SECRET env when set", () => {
    process.env.NEXORA_LICENSE_SECRET = "env-override-secret-which-is-long";
    expect(mod.readLicenseSecret()).toBe("env-override-secret-which-is-long");
    delete process.env.NEXORA_LICENSE_SECRET;
  });
});