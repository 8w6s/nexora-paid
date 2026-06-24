/**
 * Verify an ed25519-signed version manifest in the updater container.
 *
 * Threat model: a compromised FileServer (raw.githubusercontent.com is
 * unlikely but the hosted variant is plausible) could serve a malicious
 * version-pin that points at a tag we don't control. Image digest pinning
 * (already implemented in server.ts) defends if the manifest specified a
 * digest at all — but a malicious manifest can OMIT the digest field and
 * fall back to tag-based pulls. Signing the manifest closes that gap.
 *
 * Format (versions/<channel>.signed.json):
 *   {
 *     "payload": {                  // exact JSON the legacy <channel>.json had
 *       "latest": "1.1.0",
 *       "min":    "1.0.0",
 *       "imageRepo": "...",
 *       "imageTag":  "...",
 *       "sha256":    "sha256:..."
 *       ...
 *     },
 *     "signature": "<hex ed25519 signature of canonical-JSON payload bytes>"
 *   }
 *
 * Pubkey reuse: same ed25519 key the backend uses for license + manifest
 * verification (integrity.ts → LICENSE_PUBKEY_HEX). One key, three artifact
 * classes — accepted MVP simplification; split in v2 if threat model
 * tightens (see SECURITY_ARCHITECTURE.md §1).
 *
 * The updater calls this BEFORE trusting the manifest's imageRepo / imageTag
 * / sha256 fields. Verify fails closed: no signature → refuse the update.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

// Same key as backend/src/lib/integrity.ts → LICENSE_PUBKEY_HEX.
// Override via NEXORA_MANIFEST_PUBKEY_HEX for testing / key rotation.
const DEFAULT_PUBKEY_HEX = "b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3";

export interface SignedManifestPayload {
  latest: string;
  min?: string;
  channel?: string;
  imageRepo: string;
  imageTag: string;
  sha256?: string;
  publishedAt?: string;
  changelogUrl?: string;
  notes?: string;
}

export interface SignedManifest {
  payload: SignedManifestPayload;
  signature: string;
}

export interface VerifyResult {
  ok: boolean;
  payload?: SignedManifestPayload;
  reason?: string;
}

/**
 * Canonical-JSON: stable key order so signer + verifier hash the same bytes
 * regardless of writer language / library quirks.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("malformed hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function pubkeyBytes(): Uint8Array {
  const hex = (process.env.NEXORA_MANIFEST_PUBKEY_HEX || DEFAULT_PUBKEY_HEX).trim();
  if (hex.length !== 64) {
    throw new Error(`pubkey hex must be 64 chars (got ${hex.length})`);
  }
  return hexToBytes(hex);
}

/**
 * Verify a parsed SignedManifest object. Returns ok=true ONLY when the
 * signature matches the canonicalized payload under the configured pubkey.
 * Any malformed-input case fails closed (ok=false, reason set).
 */
export function verifySignedManifest(raw: unknown): VerifyResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not an object" };
  }
  const sm = raw as Partial<SignedManifest>;
  if (!sm.payload || typeof sm.payload !== "object") {
    return { ok: false, reason: "missing payload" };
  }
  if (typeof sm.signature !== "string" || sm.signature.length === 0) {
    return { ok: false, reason: "missing signature" };
  }
  if (!sm.payload.imageRepo || !sm.payload.imageTag || !sm.payload.latest) {
    return { ok: false, reason: "payload missing required fields" };
  }
  let sigBytes: Uint8Array;
  let pk: Uint8Array;
  try {
    sigBytes = hexToBytes(sm.signature);
    pk = pubkeyBytes();
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const payloadCanonical = canonicalize(sm.payload);
  const payloadBytes = new TextEncoder().encode(payloadCanonical);
  let verified: boolean;
  try {
    verified = ed.verify(sigBytes, payloadBytes, pk);
  } catch (e) {
    return { ok: false, reason: `verify threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!verified) return { ok: false, reason: "signature did not verify" };
  return { ok: true, payload: sm.payload as SignedManifestPayload };
}

/**
 * Parse a JSON string into a SignedManifest and verify in one call.
 * Returns the same shape as verifySignedManifest.
 */
export function verifySignedManifestJson(json: string): VerifyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `bad json: ${e instanceof Error ? e.message : String(e)}` };
  }
  return verifySignedManifest(raw);
}

// Exported for unit tests so the canonicalization contract is testable
// directly without going through ed25519.
export const __test = { canonicalize, hexToBytes, DEFAULT_PUBKEY_HEX };