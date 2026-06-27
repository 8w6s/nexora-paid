import type { Elysia } from "elysia";
import { db } from "../../db/connection.ts";
import { getBakedInvoiceId, getInvoiceVerdict } from "../invoice.ts";
import { isDegraded, summarizeIntegrity } from "../integrity-state.ts";
import { verifyLicense } from "../license.ts";
import { getAllSettings } from "../settings.ts";
import { NEXORA_VERSION } from "../version.ts";
import { checkCompat } from "./compat.ts";
import { hookBus } from "./hook-bus.ts";
import { runPluginMigrations } from "./migrations.ts";
import type { Plugin } from "./types.ts";

interface LoadedRecord {
  id: string;
  version: string;
  description: string;
  loaded: boolean;
  reason?: string;
}

/**
 * Discover, gate, migrate, register, and hook-subscribe every plugin from
 * the in-tree registry at `../paid/index.ts` (when present). The pipeline:
 *   1a. Integrity gate — verifyManifest() must not be degraded; otherwise
 *       NO paid plugin loads even if license is valid. Encodes the
 *       paid-tamper rule "patched binary cannot serve paid features".
 *   1b. License gate — verifyLicense() must pass; otherwise NO plugin loads.
 *   2. Per-plugin compat check — manifest.nexoraVersion vs NEXORA_VERSION.
 *   3. Per-plugin enabled flag — `feature_plugin_<id>` setting; default true.
 *      Plugins disabled here are skipped completely (no migrate, no register,
 *      no hooks).
 *   4. Per-plugin migrations — runPluginMigrations() with the plugin's SQL.
 *      Failure here skips registration but does NOT throw.
 *   5. register() — append routes to Elysia. Failures isolated per plugin.
 *   6. hooks subscribe — wire each declared hook handler into hookBus.
 *
 * We always return an app (possibly unchanged). A bad plugin is loged, not
 * fatal. We also write a summary to `globalThis.__nexora_plugins` so the
 * admin /api/admin/system/health endpoint can render plugin state without
 * rescanning.
 *
 * Boot ordering: `initIntegrity()` MUST run before `loadPlugins()` in
 * `backend/src/index.ts` so step 1a sees a real verdict. Without that
 * ordering `isDegraded()` returns false (pre-init policy: assume healthy)
 * and a tampered build would silently load paid plugins.
 */
export async function loadPlugins<A extends Elysia<any, any, any, any, any, any, any>>(
  app: A,
): Promise<A> {
  const records: LoadedRecord[] = [];

  // 0. Discover registry (Free build has no /paid/, that's fine).
  let plugins: Plugin[] = [];
  try {
    const reg = await import("../../paid/index.ts").catch(() => ({
      paidModules: undefined as Plugin[] | undefined,
    }));
    plugins = (reg as any).paidModules ?? [];
  } catch (_e) {
    (globalThis as any).__nexora_plugins = records;
    return app;
  }
  if (plugins.length === 0) {
    if (Bun.env.NODE_ENV !== "production") (globalThis as any).__nexora_plugins = records;
    return app;
  }

  // 1a. Integrity gate. When the build's signed manifest fails (tampered
  // file, invalid signature, missing in prod), refuse to register ANY paid
  // plugin. Without this gate an attacker who patched a binary could still
  // get search-suggest / admin-bulk / admin-export wired up against the
  // hashed-mismatch code. Dev tolerance for missing manifest is encoded
  // inside isDegraded() — `bun dev` without manifest is NOT degraded.
  if (isDegraded()) {
    const reason = `integrity degraded: ${summarizeIntegrity()}`;
    for (const p of plugins)
      records.push({
        id: p.manifest.id,
        version: p.manifest.version,
        description: p.manifest.description,
        loaded: false,
        reason,
      });
    (globalThis as any).__nexora_plugins = records;
    return app;
  }

  // 1b. Invoice gate — preferred path. Image is baked with NEXORA_INVOICE_ID
  // at build time; runtime fetched the matching invoices/<id>.json from the
  // private releases repo (lib/invoice.ts → initInvoiceGate()). When the
  // invoice is active + unexpired + signature OK, paid plugins load. Any
  // other state (revoked, suspended, expired, network+nocache, signature
  // mismatch) refuses all paid plugins.
  //
  // Backward compat: if NO invoice id was baked (e.g. v1 customer using the
  // old `.license` file model), fall through to the legacy verifyLicense()
  // path. Once every customer is migrated to per-invoice images, the
  // verifyLicense fallback can be removed.
  const bakedInvoiceId = getBakedInvoiceId();
  let licFeatures: string[] | undefined;
  let licIdentity: string;
  if (bakedInvoiceId) {
    const inv = getInvoiceVerdict();
    (globalThis as any).__nexora_invoice = inv;
    if (!inv.valid) {
      for (const p of plugins)
        records.push({
          id: p.manifest.id,
          version: p.manifest.version,
          description: p.manifest.description,
          loaded: false,
          reason: `invoice: ${inv.reason}`,
        });
      (globalThis as any).__nexora_plugins = records;
      return app;
    }
    licFeatures = inv.payload.features;
    licIdentity = inv.payload.email
      ? `${inv.payload.email} (invoice ${inv.payload.invoiceId})`
      : `invoice ${inv.payload.invoiceId}`;
  } else {
    const lic = await verifyLicense();
    (globalThis as any).__nexora_license = lic;
    if (!lic.valid) {
      for (const p of plugins)
        records.push({
          id: p.manifest.id,
          version: p.manifest.version,
          description: p.manifest.description,
          loaded: false,
          reason: `license: ${lic.reason}`,
        });
      (globalThis as any).__nexora_plugins = records;
      return app;
    }
    licFeatures = (lic as { payload?: { features?: string[] } }).payload?.features;
    licIdentity = lic.email;
  }
  void licIdentity;

  const settings = await getAllSettings();
  let current: any = app;

  for (const p of plugins) {
    const { id, version, description, nexoraVersion } = p.manifest;

    // 2. Compat
    const compat = checkCompat(NEXORA_VERSION, nexoraVersion);
    if (!compat.ok) {
      records.push({ id, version, description, loaded: false, reason: compat.reason });
      continue;
    }

    // 3. Per-plugin enabled flag (default: true)
    const flag = settings[`feature_plugin_${id}`];
    if (flag === "false") {
      records.push({ id, version, description, loaded: false, reason: "disabled by admin" });
      continue;
    }

    // 3b. Feature allowlist from invoice (or legacy license). Absent =
    // grant-all so v1 customers without a tier keep working. Present =
    // only listed plugin ids load — lets a single signing key gate
    // features per-tier without re-issuing the bundle.
    if (Array.isArray(licFeatures) && !licFeatures.includes(id)) {
      records.push({ id, version, description, loaded: false, reason: "not in invoice features" });
      continue;
    }

    
    // 4. Migrations (if any)
    if (p.migrations) {
      const r = await runPluginMigrations(db, id, p.migrations());
      if (r.error) {
        records.push({ id, version, description, loaded: false, reason: `migration: ${r.error}` });
        continue;
      }
    }

    // 5. register()
    if (p.register) {
      try {
        current = await p.register(current);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        records.push({ id, version, description, loaded: false, reason: `register: ${msg}` });
        continue;
      }
    }

    // 6. hooks subscribe
    if (p.hooks) {
      for (const [hookName, handler] of Object.entries(p.hooks)) {
        if (typeof handler === "function") hookBus.subscribe(id, hookName as any, handler as any);
      }
    }
    records.push({ id, version, description, loaded: true });
  }

  (globalThis as any).__nexora_plugins = records;
  return current as A;
}
