#!/usr/bin/env bun
/**
 * nexora-nxs-restore-drill.ts — Read-only restore drill for ENCRYPTED .nxs
 * snapshots produced by the updater (lib/snapshot-crypto.ts → NXS1 format).
 *
 * Counterpart to scripts/nexora-restore-drill.sh (plain .db files). Mandatory
 * because the encrypted-snapshot path is the one customers will actually run
 * on update failure — verifying that a customer's machine + license can
 * decrypt their own snapshot BEFORE the disaster is the whole point of a
 * drill. A snapshot nobody has decrypted is not a snapshot.
 *
 * Usage:
 *   bun run scripts/nexora-nxs-restore-drill.ts <snapshot.nxs> \
 *     [--license-secret=<hex>] [--machine-id=<id>] [--extract=<out.tar.gz>]
 *   Defaults (when no flag given):
 *     - --license-secret reads NEXORA_LICENSE_SECRET env, then license.lic
 *     - --machine-id     reads NEXORA_MACHINE_ID env, then /etc/machine-id
 *     - --extract        omitted → drill is read-only (decrypt + validate
 *                        magic + verify auth tag; plaintext discarded)
 *
 * Exit codes:
 *   0  PASS — snapshot decrypts, auth tag verifies, plaintext starts with
 *             a recognizable gzip / tar magic.
 *   1  FATAL — argument / file missing.
 *   2  FAIL — wrong magic, malformed file, decrypt failed (auth tag).
 *   3  FAIL — decrypts but plaintext doesn't look like a tar.gz.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decryptSnapshot, type KeyMaterial } from "../backend/src/lib/snapshot-crypto.ts";

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) flags[a.slice(2)] = "true";
      else flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readLicenseSecretFromFile(): string | null {
  const candidates = [
    process.env.NEXORA_DATA_ROOT
      ? join(process.env.NEXORA_DATA_ROOT, "app", "license.lic")
      : "/data/app/license.lic",
    "./license.lic",
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const obj = JSON.parse(raw);
      const sec = obj.signature ?? obj.sig ?? obj.secret;
      if (typeof sec === "string" && sec.length >= 16) return sec;
    } catch {
      /* try next */
    }
  }
  return null;
}

function readMachineIdFromFile(): string | null {
  const candidates = [
    process.env.NEXORA_DATA_ROOT
      ? join(process.env.NEXORA_DATA_ROOT, "app", "machine-id")
      : "/data/app/machine-id",
    "/etc/machine-id",
    "/var/lib/dbus/machine-id",
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const id = readFileSync(path, "utf8").trim();
      if (id.length >= 8) return id;
    } catch {
      /* try next */
    }
  }
  return null;
}

// biome-ignore lint/suspicious/noConsole: CLI script — stdout is the deliverable
const log = (msg: string) => console.log(`[nxs-restore-drill] ${msg}`);
// biome-ignore lint/suspicious/noConsole: CLI script — stderr for failures
const err = (msg: string) => console.error(`[nxs-restore-drill] ${msg}`);

async function main(): Promise<number> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const snapshotPath = positional[0];
  if (!snapshotPath) {
    err(
      "FATAL: usage: bun run scripts/nexora-nxs-restore-drill.ts <snapshot.nxs> [--license-secret=hex] [--machine-id=id] [--extract=out.tar.gz]",
    );
    return 1;
  }
  if (!existsSync(snapshotPath)) {
    err(`FATAL: snapshot file not found: ${snapshotPath}`);
    return 1;
  }

  const licenseSecret =
    flags["license-secret"] ?? process.env.NEXORA_LICENSE_SECRET ?? readLicenseSecretFromFile();
  const machineId = flags["machine-id"] ?? process.env.NEXORA_MACHINE_ID ?? readMachineIdFromFile();

  if (!licenseSecret) {
    err(
      "FATAL: license-secret not found. Pass --license-secret=<hex> or set NEXORA_LICENSE_SECRET or place license.lic next to script.",
    );
    return 1;
  }
  if (!machineId) {
    err(
      "FATAL: machine-id not found. Pass --machine-id=<id> or set NEXORA_MACHINE_ID or run on the same host as the snapshot.",
    );
    return 1;
  }

  const km: KeyMaterial = { licenseSecret, machineId };
  const enc = readFileSync(snapshotPath);
  const bytes = enc.length;

  // 1) Format pre-check (cheap, catches "not a NXS1 file" before we waste
  //    cycles on key derivation).
  if (bytes < 32) {
    err(`FAIL: snapshot too short (${bytes} bytes) — not a valid NXS1 file`);
    return 2;
  }
  const magic = enc.subarray(0, 4).toString("ascii");
  if (magic !== "NXS1") {
    err(`FAIL: bad magic "${magic}" (expected "NXS1")`);
    return 2;
  }

  // 2) Decrypt + auth tag verify. Any tampering, wrong key, or wrong machine
  //    fails here.
  let plain: Buffer;
  try {
    plain = decryptSnapshot(enc, km);
  } catch (e) {
    err(`FAIL: decrypt failed — ${e instanceof Error ? e.message : String(e)}`);
    err(
      "Common causes: snapshot encrypted on a different machine, license rotated, or file corrupted.",
    );
    return 2;
  }

  // 3) Plaintext sanity. Encrypted snapshots wrap a `tar czf` blob — first
  //    two bytes should be the gzip magic 0x1f 0x8b. If they're not, the
  //    key matched a different file format (suggesting cross-version drift).
  if (plain.length < 2) {
    err(`FAIL: plaintext is empty after decrypt — snapshot may be a placeholder`);
    return 3;
  }
  const gzipMagic = plain[0] === 0x1f && plain[1] === 0x8b;
  if (!gzipMagic) {
    err(
      `FAIL: plaintext does not start with gzip magic (got 0x${plain[0].toString(16)} 0x${plain[1].toString(16)}) — snapshot format unrecognized`,
    );
    return 3;
  }

  const extractPath = flags.extract;
  if (extractPath) {
    writeFileSync(extractPath, plain);
    log(`extracted plaintext to ${extractPath} (${plain.length} bytes)`);
  }

  log(`PASS ${snapshotPath} (cipher=${bytes}B, plaintext=${plain.length}B, format=tar.gz)`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    err(`FATAL: unhandled — ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
