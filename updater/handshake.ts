/**
 * Byte-identical-in-spirit copy of backend/src/lib/updater-handshake.ts.
 * Kept separate so the updater container does not import from the backend
 * source tree — the two ship as independent Docker images.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const HEADER_TS = "x-updater-ts";
export const HEADER_NONCE = "x-updater-nonce";
export const HEADER_AUTH = "x-updater-auth";

const MAX_SKEW_MS = 30_000;
const NONCE_CACHE_SIZE = 4096;

function pskOrThrow(): string {
  const psk = process.env.NEXORA_UPDATER_PSK;
  if (!psk || psk.length < 32) {
    throw new Error(
      "NEXORA_UPDATER_PSK missing or too short (need >=32 chars). " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return psk;
}

function hmac(psk: string, ts: string, nonce: string, body: string): string {
  return createHmac("sha256", psk).update(`${ts}
${nonce}
${body}`).digest("hex");
}

export function signRequest(body: string): Record<string, string> {
  const psk = pskOrThrow();
  const ts = Date.now().toString();
  const nonce = randomBytes(16).toString("hex");
  return {
    [HEADER_TS]: ts,
    [HEADER_NONCE]: nonce,
    [HEADER_AUTH]: hmac(psk, ts, nonce, body),
  };
}

const seenNonces = new Map<string, number>();

export interface VerifyResult {
  ok: boolean;
  reason?: "missing" | "skew" | "replay" | "mismatch" | "no-psk";
}

export function verifyRequest(headers: Headers, body: string): VerifyResult {
  let psk: string;
  try {
    psk = pskOrThrow();
  } catch {
    return { ok: false, reason: "no-psk" };
  }
  const ts = headers.get(HEADER_TS);
  const nonce = headers.get(HEADER_NONCE);
  const auth = headers.get(HEADER_AUTH);
  if (!ts || !nonce || !auth) return { ok: false, reason: "missing" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_SKEW_MS) {
    return { ok: false, reason: "skew" };
  }
  if (seenNonces.has(nonce)) return { ok: false, reason: "replay" };

  const expected = hmac(psk, ts, nonce, body);
  if (expected.length !== auth.length) return { ok: false, reason: "mismatch" };
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(auth, "hex"))) {
    return { ok: false, reason: "mismatch" };
  }

  seenNonces.set(nonce, tsNum);
  if (seenNonces.size > NONCE_CACHE_SIZE) {
    const drop = seenNonces.size - NONCE_CACHE_SIZE;
    let i = 0;
    for (const k of seenNonces.keys()) {
      seenNonces.delete(k);
      if (++i >= drop) break;
    }
  }
  return { ok: true };
}