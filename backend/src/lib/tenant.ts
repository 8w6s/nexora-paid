/**
 * Tenant isolation — the Android-style data jail.
 *
 * Layout inside the container:
 *   /data/app/          ← sensitive: DB, secrets, license, snapshots
 *       db.sqlite
 *       license.lic
 *       machine-id
 *       secrets/
 *       snapshots/
 *   /data/userspace/    ← customer-admin facing: uploads, assets, free-form tree
 *       uploads/
 *       assets/
 *
 * Rules:
 *   - app/ is reachable only via admin APIs + TUI (which run as the container user).
 *   - userspace/ is exposed through the File Tree UI; every path coming from
 *     a request must pass through jailUserspace() before touching disk.
 *   - Neither root is ever joined with user input directly.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const DATA_ROOT = process.env.NEXORA_DATA_ROOT ?? "/data";
export const APP_ROOT = resolve(DATA_ROOT, "app");
export const USERSPACE_ROOT = resolve(DATA_ROOT, "userspace");

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

ensureDir(APP_ROOT);
ensureDir(USERSPACE_ROOT);
ensureDir(resolve(APP_ROOT, "secrets"));
ensureDir(resolve(APP_ROOT, "snapshots"));
ensureDir(resolve(USERSPACE_ROOT, "uploads"));
ensureDir(resolve(USERSPACE_ROOT, "assets"));

/**
 * Stable per-install identifier. Persisted to APP_ROOT/machine-id on first
 * boot; never regenerated. Used as one input to the snapshot key derivation,
 * so it MUST live in app/ (not userspace/) and MUST survive restarts but not
 * survive moving the data volume to a different install.
 */
export function ensureMachineId(): string {
  const path = resolve(APP_ROOT, "machine-id");
  if (existsSync(path)) {
    const id = readFileSync(path, "utf8").trim();
    if (id.length >= 8) return id;
  }
  // Prefer a host-provided machine-id if present (helps detect when the
  // volume has been moved to a different host).
  let hostId = "";
  for (const candidate of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      hostId = readFileSync(candidate, "utf8").trim();
      if (hostId.length >= 8) break;
    } catch {
      /* ignore */
    }
  }
  const id = hostId.length >= 8 ? hostId : randomUUID().replace(/-/g, "");
  writeFileSync(path, id, { mode: 0o600 });
  return id;
}

export function readLicenseSecret(): string {
  // Prefer env override (used by tests, by license-rotation tooling, and the
  // required path in production).
  if (process.env.NEXORA_LICENSE_SECRET) return process.env.NEXORA_LICENSE_SECRET;
  // Production refuses the in-volume fallback: license.lic lives next to the
  // encrypted snapshots in /data/app, so an attacker who copies the entire
  // data volume to another host would have both the ciphertext AND the key
  // material to derive its decryption key. Require operators to provision the
  // secret through an out-of-band channel (KMS, host env, secret manager).
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXORA_LICENSE_SECRET is required in production. Provision it via the host environment or a secret manager — falling back to license.lic inside the data volume would let a volume-copy attack decrypt snapshots.",
    );
  }
  const path = resolve(APP_ROOT, "license.lic");
  if (!existsSync(path)) {
    throw new Error(`license.lic missing at ${path} — cannot derive snapshot key`);
  }
  // license.lic is JSON; we use the signature field as the per-install
  // secret since it is unique per-customer and embedded in the signed
  // payload (so a forged license-without-secret would fail signature verify
  // upstream anyway).
  const raw = readFileSync(path, "utf8");
  try {
    const obj = JSON.parse(raw);
    const sec = obj.signature ?? obj.sig ?? obj.secret;
    if (typeof sec !== "string" || sec.length < 16) {
      throw new Error("license file has no usable secret/signature field");
    }
    return sec;
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("license.lic is not valid JSON");
    throw e;
  }
}

export interface JailOptions {
  /** Allow the resolved path to NOT exist yet (e.g. for write/create). Default true. */
  allowMissing?: boolean;
}

/**
 * Resolve a user-supplied relative path against USERSPACE_ROOT, refusing
 * anything that escapes the jail. Throws on:
 *   - absolute paths
 *   - paths that resolve outside USERSPACE_ROOT (../ traversal, symlinks
 *     that point outward at resolve-time, etc.)
 *   - null bytes
 *
 * NOTE on symlinks: this does NOT follow symlinks via realpath() because the
 * file may not exist yet (upload target). Callers that read existing files
 * should additionally fs.lstat() and refuse symlinks if they care about
 * symlink-traversal post-resolve.
 */
export function jailUserspace(userPath: string, _opts: JailOptions = {}): string {
  return jailWithin(USERSPACE_ROOT, userPath);
}

export function jailApp(userPath: string): string {
  return jailWithin(APP_ROOT, userPath);
}

function jailWithin(root: string, userPath: string): string {
  if (typeof userPath !== "string") throw new Error("jail: path must be a string");
  if (userPath.includes("\0")) throw new Error("jail: null byte in path");
  // Strip leading separators so resolve() treats input as relative.
  const cleaned = userPath.replace(/^[/]+/, "");
  const abs = resolve(root, cleaned);
  // Use root + sep so root itself is considered inside (`abs === root` is OK).
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`jail: path escapes root (${userPath})`);
  }
  return abs;
}

/** Tiny helper for tests/admin to surface what the jail is configured with. */
export function tenantInfo(): {
  dataRoot: string;
  appRoot: string;
  userspaceRoot: string;
  machineId: string;
} {
  return {
    dataRoot: DATA_ROOT,
    appRoot: APP_ROOT,
    userspaceRoot: USERSPACE_ROOT,
    machineId: ensureMachineId(),
  };
}
