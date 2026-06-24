/**
 * Bot-time integrity verifier for Nexora Paid v1.1.
 *
 * Reads `manifest.signed.json` (produced by `scripts/build-manifest.ts`),
 * verifies the ed25519 signature with the embedded public key, then walks
 * every file listed in the payload and confirms the on-disk SHA256 matches.
 *
 *   - Pass  → caller flips `IntegrityState.ok = true`, boots normally.
 *   - Fail  → caller enters DEGRADED mode (see docs/SECURITY_ARCHITECTURE.md):
 *               storefront stays read-only, paid plugins refuse to load,
 *               admin mutations 503, /export still works.
 *
 * This module is PURE — it does not touch global state, does not log on
 * its own, does not gate any feature. It returns a result; the caller
 * (e.g. backend/src/index.ts boot path or paid/index.ts gate) acts on it.
 *
 * Self-reference caveat: this file is itself listed in the manifest. A
 * targeted attacker who patches *both* the manifest signature check *and*
 * this file's hash entry can defeat the verifier. That is out of scope of
 * the "casual crack" threat model — see SECURITY_ARCHITECTURE.md §1.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

// @noble/ed25519 v3 requires a sync sha512 hook registered before any verify.
if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

/**
 * PUBLIC KEY for verifying signed manifests (hex, 32 bytes / 64 chars).
 *
 * MVP simplification: this is the SAME key that signs `.license` files
 * (see `backend/src/lib/license.ts → LICENSE_PUBKEY_HEX`). A compromise
 * of the private key breaks both layers; split into a dedicated build
 * signer in v2+ if the threat model tightens.
 *
 * The all-zero placeholder makes every verify fail closed — so a Paid
 * build that forgets to embed the real key boots into degraded mode
 * rather than silently trusting nothing.
 */
const BUILD_PUBKEY_HEX = "b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3";

export interface ManifestPayload {
  version: 1;
  buildId: string;
  customerId: string | null;
  issuedAt: string;
  files: Record<string, string>;
}

export interface SignedManifest {
  payload: ManifestPayload;
  signature: string;
}

export interface FileMismatch {
  path: string;
  expected: string;
  actual: string | null;
}

export type IntegrityResult =
  | { ok: true; skipped: true; reason: "dev_skip" }
  | {
      ok: true;
      skipped: false;
      buildId: string;
      customerId: string | null;
      issuedAt: string;
      checked: number;
    }
  | {
      ok: false;
      reason:
        | "manifest_not_found"
        | "manifest_unreadable"
        | "manifest_malformed"
        | "signature_invalid"
        | "files_mismatch"
        | "build_pubkey_not_set";
      mismatches: FileMismatch[];
      buildId?: string;
    };

export interface VerifyOptions {
  /** Override manifest lookup. Absolute path or relative to cwd. */
  manifestPath?: string;
  /**
   * Root directory the manifest's `files` paths are relative to. Defaults
   * to `dirname(manifestPath)` — i.e. paths are interpreted from where the
   * manifest sits, which matches what `build-manifest.ts` writes.
   */
  rootDir?: string;
  /**
   * Force-skip — useful in `hot-reload` dev where file mtimes constantly
   * shift. Default: read `NEXORA_DEV_SKIP_INTEGRITY` env var.
   */
  devSkip?: boolean;
}

/**
 * Look up the manifest file. Order:
 *   1. opts.manifestPath if provided
 *   2. NEXORA_MANIFEST_FILE env var
 *   3. ./manifest.signed.json (cwd)
 *   4. ../manifest.signed.json (project root when backend is run from backend/)
 *
 * Returns the first existing path, or null when nothing matches.
 */
export function resolveManifestPath(opts: VerifyOptions = {}): string | null {
  const cwd = process.cwd();
  const candidates = [
    opts.manifestPath,
    process.env.NEXORA_MANIFEST_FILE,
    resolve(cwd, "manifest.signed.json"),
    resolve(cwd, "..", "manifest.signed.json"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const c of candidates) {
    const abs = isAbsolute(c) ? c : resolve(cwd, c);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

/**
 * Verify the signed manifest + every listed file's on-disk hash.
 *
 * Side-effect-free: reads files, returns a structured result. The caller
 * decides what to do with `ok:false` (log, enter degraded mode, etc).
 */
export async function verifyManifest(opts: VerifyOptions = {}): Promise<IntegrityResult> {
  // Dev escape hatch — surfaced loud by the caller (see boot path).
  const devSkip =
    opts.devSkip ??
    (process.env.NEXORA_DEV_SKIP_INTEGRITY === "true" ||
      process.env.NEXORA_DEV_SKIP_INTEGRITY === "1");
  if (devSkip) return { ok: true, skipped: true, reason: "dev_skip" };

  // Refuse to "verify" with the placeholder key — that would always-fail
  // anyway, but the explicit reason helps an operator diagnose a build
  // that forgot to embed the real key.
  if (/^0+$/.test(BUILD_PUBKEY_HEX)) {
    return { ok: false, reason: "build_pubkey_not_set", mismatches: [] };
  }

  const manifestPath = resolveManifestPath(opts);
  if (!manifestPath) {
    return { ok: false, reason: "manifest_not_found", mismatches: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf-8");
  } catch {
    return { ok: false, reason: "manifest_unreadable", mismatches: [] };
  }

  let signed: SignedManifest;
  try {
    const parsed = JSON.parse(raw) as Partial<SignedManifest>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.signature !== "string" ||
      !parsed.payload ||
      typeof parsed.payload !== "object" ||
      parsed.payload.version !== 1 ||
      typeof parsed.payload.buildId !== "string" ||
      typeof parsed.payload.files !== "object" ||
      parsed.payload.files === null
    ) {
      return { ok: false, reason: "manifest_malformed", mismatches: [] };
    }
    signed = parsed as SignedManifest;
  } catch {
    return { ok: false, reason: "manifest_malformed", mismatches: [] };
  }

  // Verify signature using the canonical-JSON shape produced by
  // build-manifest.ts. We must reproduce the SAME byte sequence here —
  // any drift in canonicalize() between writer and reader breaks every
  // signature. Keep these two functions in lockstep.
  const payloadBytes = new TextEncoder().encode(canonicalize(signed.payload));
  const sigBytes = hexToBytes(signed.signature);
  const pubBytes = hexToBytes(BUILD_PUBKEY_HEX);

  let sigOk = false;
  try {
    sigOk = await ed.verify(sigBytes, payloadBytes, pubBytes);
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return {
      ok: false,
      reason: "signature_invalid",
      mismatches: [],
      buildId: signed.payload.buildId,
    };
  }

  // Signature is good — now walk the file map and confirm each hash.
  const root = opts.rootDir ?? dirname(manifestPath);
  const mismatches: FileMismatch[] = [];
  let checked = 0;
  for (const [relPath, expected] of Object.entries(signed.payload.files)) {
    const abs = resolve(root, relPath);
    if (!existsSync(abs)) {
      mismatches.push({ path: relPath, expected, actual: null });
      continue;
    }
    try {
      const bytes = readFileSync(abs);
      const actual = bytesToHex(sha256(bytes));
      if (actual !== expected) {
        mismatches.push({ path: relPath, expected, actual });
      }
      checked++;
    } catch {
      mismatches.push({ path: relPath, expected, actual: null });
    }
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      reason: "files_mismatch",
      mismatches,
      buildId: signed.payload.buildId,
    };
  }

  return {
    ok: true,
    skipped: false,
    buildId: signed.payload.buildId,
    customerId: signed.payload.customerId,
    issuedAt: signed.payload.issuedAt,
    checked,
  };
}

// ─── Canonical JSON (must match scripts/build-manifest.ts canonicalize) ───

function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
    }
    return v;
  });
}

// ─── Hex helpers ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * Human-friendly summary string for logging / baner. Doesn't allocate
 * much; safe to call from hot paths.
 */
export function summarizeResult(r: IntegrityResult): string {
  if (r.ok && r.skipped) return "[integrity] SKIPPED (dev mode)";
  if (r.ok) return `[integrity] OK build=${r.buildId} files=${r.checked}`;
  const head = `[integrity] FAIL reason=${r.reason}`;
  if (r.mismatches.length === 0) return head;
  const first = r.mismatches
    .slice(0, 3)
    .map((m) => m.path)
    .join(", ");
  const more = r.mismatches.length > 3 ? ` +${r.mismatches.length - 3} more` : "";
  return `${head} files=[${first}${more}]`;
}
