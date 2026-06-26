/**
 * Singleton wrapper around `verifyManifest()` (see `./integrity.ts`).
 *
 * The boot path calls `initIntegrity()` once, very early; later modules
 * read `getIntegrityState()` / `isDegraded()` to decide whether to engage
 * paid plugins, allow admin mutations, etc. By caching the result here
 * we (a) avoid re-hashing the entire source tree on every gate check
 * and (b) ensure every consumer sees the SAME verdict — a re-verify that
 * accidentally returned a different answer would let a stolen cookie
 * race past one gate while another gate failed it.
 *
 * Lifecycle:
 *   bot path (index.ts) ─→ await initIntegrity()
 *                          └─→ verifyManifest() reads manifest.signed.json
 *                              and walks every listed file
 *   consumer       ─→ getIntegrityState() / isDegraded() / summarize()
 *                     (sync; reads cached result)
 *
 * Production policy (NODE_ENV=production):
 *   - manifest_not_found      → degraded (ship-time misconfig: build forgot to ship manifest)
 *   - signature_invalid       → degraded (tamper or wrong customer's manifest)
 *   - files_mismatch          → degraded (binary patch)
 *   - build_pubkey_not_set    → degraded (build forgot to embed real pubkey)
 *
 * Development policy (NODE_ENV !== "production"):
 *   - manifest_not_found      → NOT degraded (devs don't run build-manifest.ts every save)
 *   - everything else         → degraded (still flag real tampering)
 *   - NEXORA_DEV_SKIP_INTEGRITY=true → globally skip (covered by verifyManifest itself)
 */
import type { IntegrityInfo } from "./banner.ts";
import { type IntegrityResult, summarizeResult, verifyManifest } from "./integrity.ts";

let cached: IntegrityResult | null = null;
let initPromise: Promise<IntegrityResult> | null = null;

/**
 * Run the verifier once and cache the result. Safe to call multiple times —
 * subsequent calls return the cached verdict without re-hashing files.
 *
 * Returns the result so the caller (boot path) can immediately pass it to
 * the banner / log without a second accessor call.
 */
export async function initIntegrity(): Promise<IntegrityResult> {
  if (cached) return cached;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const r = await verifyManifest();
      cached = r;
      return r;
    } catch (e) {
      // Defensive: a thrown verifyManifest would silently turn into
      // "no integrity state" — surface it explicitly as an unreadable
      // manifest so consumers gate the same way as a structured fail.
      cached = {
        ok: false,
        reason: "manifest_unreadable",
        mismatches: [],
      };
      // Boot-time diagnostic — operator MUST see why integrity init failed.
      // (noConsole rule for this file is disabled in biome.json overrides.)
      console.error("[integrity] verifyManifest threw:", e);
      return cached;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

/**
 * Read the cached verdict. Throws if `initIntegrity()` has not been called —
 * that's a programer error (we must always init before gating), not a
 * security failure.
 */
export function getIntegrityState(): IntegrityResult {
  if (!cached) {
    throw new Error(
      "[integrity] getIntegrityState() called before initIntegrity() — wire boot path first",
    );
  }
  return cached;
}

/**
 * True when the running build should refuse paid features / admin
 * mutations. Encodes the dev-vs-prod policy described at the top of the
 * file so consumers don't each re-implement the rule.
 */
export function isDegraded(): boolean {
  if (!cached) return false; // pre-init: caller hasn't booted yet, treat as healthy
  if (cached.ok) return false;

  // Dev tolerance: missing manifest is the default state for developers
  // running `bun dev`. Only flag real tamper paths.
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd && cached.reason === "manifest_not_found") return false;

  return true;
}

/**
 * Mutation-blocking onBeforeHandle handler for Elysia plugin routes.
 *
 * The legacy `adminRoutes` instance in admin.ts has its own inline gate; this
 * helper exists so every OTHER admin plugin mount (admin-db, admin-tables,
 * admin-update, admin-blocklist, admin-2fa) can hang the SAME degraded-mode
 * check off its own `onBeforeHandle` chain without duplicating the logic.
 *
 * GETs/HEADs pass through so an operator can still reach the health endpoint
 * and read the red banner that explains the degraded state.
 */
export function degradedGate(ctx: { request: Request; set: { status?: number } }):
  | { error: string; code: string; hint: string }
  | undefined {
  const m = ctx.request.method;
  if (m === "GET" || m === "HEAD") return;
  if (!isDegraded()) return;
  ctx.set.status = 503;
  return {
    error: "Integrity verification failed — admin mutations disabled until resolved",
    code: "INTEGRITY_DEGRADED",
    hint: "GET /api/admin/system/health",
  };
}

/**
 * Human-friendly one-liner for bot banner / health endpoint. Wraps
 * `summarizeResult()` from the integrity module and adds the degraded
 * verdict so an operator can see "OK but degraded" semantics.
 */
export function summarizeIntegrity(): string {
  if (!cached) return "[integrity] not initialized";
  const base = summarizeResult(cached);
  if (cached.ok) return base;
  return `${base} degraded=${isDegraded() ? "yes" : "no"}`;
}

/**
 * Map the raw `IntegrityResult` to the banner-local `IntegrityInfo` shape.
 * Centralized here so future consumers (admin /system/health endpoint,
 * structured log emitter) don't each re-derive the same fields.
 *
 * Reads `isDegraded()` for the fail variant — caller must have run
 * `initIntegrity()` first, or `isDegraded()` returns false (no cache) and
 * the banner will paint "not degraded" even when it should. Boot path
 * ordering guarantees init-before-banner; if you call this elsewhere,
 * await init first.
 */
export function toBannerInfo(r: IntegrityResult): IntegrityInfo {
  if (r.ok && r.skipped) return { ok: true, skipped: true };
  if (r.ok) {
    return {
      ok: true,
      skipped: false,
      checked: r.checked,
      buildId: r.buildId,
    };
  }
  return {
    ok: false,
    reason: r.reason,
    degraded: isDegraded(),
    mismatchCount: r.mismatches.length,
    buildId: r.buildId,
  };
}

/**
 * Test-only: clear the cache so a unit test can re-init under different
 * env. NEVER call from production code; gating relies on a stable verdict.
 */
export function __resetForTest(): void {
  cached = null;
  initPromise = null;
}
