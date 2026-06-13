import type { Elysia } from "elysia";
import { db } from "../../db/connection.ts";
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
 *   1. License gate — verifyLicense() must pass; otherwise NO plugin loads.
 *   2. Per-plugin compat check — manifest.nexoraVersion vs NEXORA_VERSION.
 *   3. Per-plugin enabled flag — `feature_plugin_<id>` setting; default true.
 *      Plugins disabled here are skipped completely (no migrate, no register,
 *      no hooks).
 *   4. Per-plugin migrations — runPluginMigrations() with the plugin's SQL.
 *      Failure here skips registration but does NOT throw.
 *   5. register() — append routes to Elysia. Failures isolated per plugin.
 *   6. hooks subscribe — wire each declared hook handler into hookBus.
 *
 * We always return an app (possibly unchanged). A bad plugin is logged, not
 * fatal. We also write a summary to `globalThis.__nexora_plugins` so the
 * admin endpoint added in Task 6 can render plugin state without rescanning.
 */
export async function loadPlugins<A extends Elysia<any, any, any, any, any, any, any, any>>(
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

  // 1. License gate (build-wide; per-plugin signing comes in Phase 2).
  const lic = await verifyLicense();
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

  const settings = await getAllSettings();
  let current: any = app;

  for (const p of plugins) {
    const { id, version, description, nexoraVersion } = p.manifest;
    const _tag = `${id}@${version}`;

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
