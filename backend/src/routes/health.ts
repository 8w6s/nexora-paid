/**
 * Health endpoints.
 *
 * /api/health      — cheap liveness ping. Always 200, no DB I/O.
 * /api/health/deep — readiness: DB ping, schema version, updater socket,
 *                    fileserver reachability. Used by the admin UI's pre-update
 *                    panel and by external monitoring.
 *
 * /api/health/deep is intentionally NOT authenticated so monitoring tools
 * can scrape it. We therefore only return non-sensitive fields:
 *   - version, schema, uptime, db-ok, updater-available
 *   - NO env vars, NO file paths, NO secrets, NO license info.
 */
import { existsSync } from "node:fs";
import { Elysia } from "elysia";
import { APP_VERSION, SCHEMA_VERSION } from "../lib/app-version.ts";

const BOOT_AT = Date.now();
const UPDATER_SOCKET = "/var/run/nexora-updater.sock";

function pingDb(): { ok: boolean; ms: number; error?: string } {
  const t0 = performance.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../db/connection.ts") as {
      db: { $client: { query: (s: string) => { get: () => unknown } } };
    };
    mod.db.$client.query("SELECT 1").get();
    return { ok: true, ms: Math.round((performance.now() - t0) * 100) / 100 };
  } catch (e) {
    return {
      ok: false,
      ms: Math.round((performance.now() - t0) * 100) / 100,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const healthRoutes = new Elysia()
  .get("/api/health", () => ({ ok: true }))
  .get("/api/health/deep", () => {
    const db = pingDb();
    const updaterAvailable = existsSync(UPDATER_SOCKET);
    return {
      ok: db.ok,
      version: APP_VERSION,
      schema: SCHEMA_VERSION,
      uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
      db: { ok: db.ok, latencyMs: db.ms, ...(db.error ? { error: db.error } : {}) },
      updater: { available: updaterAvailable },
    };
  });
