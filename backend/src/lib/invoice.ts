/**
 * Per-invoice runtime gate.
 *
 * Architecture:
 *   - Each customer's image is built with `ARG NEXORA_INVOICE_ID` baked
 *     into the layer (see `customer-build.yml`). At boot the backend reads
 *     `process.env.NEXORA_INVOICE_ID` — this value cannot be tampered with
 *     by the customer-admin (it's frozen in the image).
 *   - The maintainer's private `nexora-releases` repo holds one signed
 *     JSON file per invoice at `invoices/<invoiceId>.json`.
 *   - The backend fetches that file at boot + every 24h, verifies the
 *     ed25519 signature with the same key used for licenses/manifests,
 *     and caches the verdict on disk so brief network blips don't disable
 *     paid features.
 *   - `status: revoked|suspended` OR `expiresAt < now()` → invalid →
 *     paid plugins refuse to load.
 *
 * Auth note:
 *   - Releases repo is private; the in-image `NEXORA_GHCR_TOKEN` (PAT with
 *     `repo` scope on releases repo + `read:packages` for GHCR pulls) is
 *     reused as the bearer token. Customers don't see this token — it's
 *     baked into the image they download from GHCR.
 *
 * Failure modes:
 *   - 404 (invoice deleted)   → invalid, banner red.
 *   - network error           → fall back to last cached verdict if fresh
 *                               (<7 days), else invalid.
 *   - signature mismatch      → invalid.
 *   - INVOICE_ID env missing  → development mode: treat as `dev` (paid
 *                               features off, no network call). Production
 *                               with missing INVOICE_ID → invalid.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

const DEFAULT_PUBKEY_HEX = "b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STALE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export interface InvoicePayload {
  invoiceId: string;
  email: string;
  status: "active" | "revoked" | "suspended";
  issuedAt: string;
  productId: "nexora-paid";
  expiresAt?: string;
  features?: string[];
  note?: string;
}

export interface SignedInvoice {
  payload: InvoicePayload;
  signature: string;
}

export type InvoiceVerdict =
  | { valid: true; payload: InvoicePayload; source: "fresh" | "cached" }
  | { valid: false; reason: string; payload?: InvoicePayload };

interface CacheRecord {
  fetchedAt: number;
  signed: SignedInvoice;
}

let lastVerdict: InvoiceVerdict | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error("malformed hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function pubkeyBytes(): Uint8Array {
  const hex = (process.env.NEXORA_INVOICE_PUBKEY_HEX || DEFAULT_PUBKEY_HEX).trim();
  if (hex.length !== 64) throw new Error(`pubkey hex must be 64 chars (got ${hex.length})`);
  return hexToBytes(hex);
}

function cachePath(): string {
  const root = process.env.NEXORA_DATA_ROOT ?? (process.env.DB_PATH ? resolve(process.env.DB_PATH, "..") : process.cwd());
  return resolve(root, "invoice-cache.json");
}

function readCache(): CacheRecord | null {
  try {
    const p = cachePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (raw?.signed?.payload?.invoiceId && typeof raw.fetchedAt === "number") return raw;
  } catch {
    /* corrupt cache → ignore */
  }
  return null;
}

function writeCache(rec: CacheRecord): void {
  try {
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(rec, null, 2));
  } catch (e) {
    console.warn("[invoice] could not persist cache:", e instanceof Error ? e.message : e);
  }
}

async function verifySignedInvoice(raw: unknown, expectId: string): Promise<InvoiceVerdict> {
  if (!raw || typeof raw !== "object") return { valid: false, reason: "invoice not an object" };
  const sm = raw as Partial<SignedInvoice>;
  if (!sm.payload || typeof sm.payload !== "object") return { valid: false, reason: "missing payload" };
  if (typeof sm.signature !== "string" || sm.signature.length === 0)
    return { valid: false, reason: "missing signature" };
  const p = sm.payload as Partial<InvoicePayload>;
  if (!p.invoiceId || !p.email || !p.status || !p.issuedAt || p.productId !== "nexora-paid") {
    return { valid: false, reason: "malformed payload" };
  }
  if (p.invoiceId !== expectId) {
    return {
      valid: false,
      reason: `invoice id mismatch (image=${expectId}, file=${p.invoiceId})`,
    };
  }

  let sigBytes: Uint8Array;
  let pk: Uint8Array;
  try {
    sigBytes = hexToBytes(sm.signature);
    pk = pubkeyBytes();
  } catch (e) {
    return { valid: false, reason: `hex/pubkey: ${e instanceof Error ? e.message : String(e)}` };
  }
  const msg = new TextEncoder().encode(canonicalize(sm.payload));
  let ok = false;
  try {
    ok = await ed.verify(sigBytes, msg, pk);
  } catch (e) {
    return { valid: false, reason: `verify threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!ok) return { valid: false, reason: "signature mismatch" };

  const payload = sm.payload as InvoicePayload;
  if (payload.status !== "active") {
    return { valid: false, reason: `invoice status=${payload.status}`, payload };
  }
  if (payload.expiresAt) {
    const exp = Date.parse(payload.expiresAt);
    if (!Number.isFinite(exp)) return { valid: false, reason: "bad expiresAt", payload };
    if (Date.now() > exp) return { valid: false, reason: `expired at ${payload.expiresAt}`, payload };
  }
  return { valid: true, payload, source: "fresh" };
}

function releasesRepo(): { owner: string; repo: string; branch: string } {
  const slug = (process.env.NEXORA_RELEASES_REPO ?? "8w6s/nexora-releases").trim();
  const [owner, repo] = slug.split("/");
  const branch = process.env.NEXORA_RELEASES_BRANCH ?? "main";
  if (!owner || !repo) throw new Error(`bad NEXORA_RELEASES_REPO: ${slug}`);
  return { owner, repo, branch };
}

async function fetchInvoiceJson(invoiceId: string): Promise<unknown> {
  const { owner, repo, branch } = releasesRepo();
  const token = process.env.NEXORA_GHCR_TOKEN || process.env.GHCR_TOKEN || "";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/invoices/${encodeURIComponent(invoiceId)}.json?ref=${encodeURIComponent(branch)}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github.raw+json",
    "user-agent": "nexora-invoice-gate",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (r.status === 404) throw new Error("invoice_not_found");
  if (!r.ok) throw new Error(`releases ${r.status}`);
  return await r.json();
}

/**
 * Refresh the in-memory + on-disk cache by fetching the invoice file
 * from the releases repo. Returns the new verdict (which may be invalid
 * even when the fetch itself succeeds — e.g. status=revoked).
 */
export async function refreshInvoice(): Promise<InvoiceVerdict> {
  const invoiceId = (process.env.NEXORA_INVOICE_ID ?? "").trim();
  if (!invoiceId) {
    const isProd = process.env.NODE_ENV === "production";
    const verdict: InvoiceVerdict = isProd
      ? { valid: false, reason: "NEXORA_INVOICE_ID not baked into image (production)" }
      : { valid: false, reason: "dev build — no invoice id" };
    lastVerdict = verdict;
    return verdict;
  }

  try {
    const raw = await fetchInvoiceJson(invoiceId);
    const verdict = await verifySignedInvoice(raw, invoiceId);
    if (verdict.valid || verdict.payload) {
      writeCache({ fetchedAt: Date.now(), signed: raw as SignedInvoice });
    }
    lastVerdict = verdict;
    return verdict;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (reason === "invoice_not_found") {
      lastVerdict = { valid: false, reason: `invoice ${invoiceId} not found in releases repo` };
      return lastVerdict;
    }
    // Network/timeout → fall back to cache if fresh enough.
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < STALE_GRACE_MS) {
      const verdict = await verifySignedInvoice(cached.signed, invoiceId);
      if (verdict.valid) {
        lastVerdict = { ...verdict, source: "cached" };
        return lastVerdict;
      }
      lastVerdict = verdict;
      return verdict;
    }
    lastVerdict = { valid: false, reason: `fetch failed and no fresh cache: ${reason}` };
    return lastVerdict;
  }
}

/**
 * Read the cached verdict (synchronous). Caller MUST have awaited
 * `refreshInvoice()` (or `initInvoiceGate()`) at boot.
 */
export function getInvoiceVerdict(): InvoiceVerdict {
  if (!lastVerdict) {
    return { valid: false, reason: "invoice gate not initialised" };
  }
  return lastVerdict;
}

/**
 * Boot-time entry point. Awaits one refresh, then schedules a background
 * refresh every 24h. Returns the initial verdict.
 */
export async function initInvoiceGate(): Promise<InvoiceVerdict> {
  const verdict = await refreshInvoice();
  if (refreshTimer) clearTimeout(refreshTimer);
  const tick = async (): Promise<void> => {
    try {
      await refreshInvoice();
    } catch {
      /* refreshInvoice never throws; this is a belt-and-suspenders catch */
    }
    refreshTimer = setTimeout(tick, REFRESH_INTERVAL_MS);
    if (typeof (refreshTimer as { unref?: () => void }).unref === "function") {
      (refreshTimer as { unref?: () => void }).unref?.();
    }
  };
  refreshTimer = setTimeout(tick, REFRESH_INTERVAL_MS);
  if (typeof (refreshTimer as { unref?: () => void }).unref === "function") {
    (refreshTimer as { unref?: () => void }).unref?.();
  }
  return verdict;
}

/** Test-only: clear cache + timer + last verdict. */
export function __resetInvoiceForTest(): void {
  lastVerdict = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** Surface the baked invoice id for diagnostics. */
export function getBakedInvoiceId(): string {
  return (process.env.NEXORA_INVOICE_ID ?? "").trim();
}