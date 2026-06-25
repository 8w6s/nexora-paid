/**
 * Health route smoke tests.
 *
 * /api/health is the cheapest liveness probe; it must always return 200
 * with {ok:true} regardless of DB or updater state. Caddy depends_on
 * health gate relies on it. /api/health/deep adds version + schema +
 * uptime + db latency for the admin pre-update panel and external
 * monitoring, but must never leak env/paths/secrets.
 */
import { describe, expect, it } from "bun:test";
import { healthRoutes } from "./health.ts";

async function call(path: string): Promise<{ status: number; body: unknown }> {
  const res = await healthRoutes.handle(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.json() };
}

describe("health routes", () => {
  it("/api/health returns {ok:true} with 200", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it("/api/health/deep returns version + schema + uptime", async () => {
    const r = await call("/api/health/deep");
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(typeof body.version).toBe("string");
    expect(typeof body.schema).toBe("number");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.uptimeSec as number).toBeGreaterThanOrEqual(0);
  });

  it("/api/health/deep includes db + updater sub-objects", async () => {
    const r = await call("/api/health/deep");
    const body = r.body as { db: { ok: boolean; latencyMs: number }; updater: { available: boolean } };
    expect(typeof body.db.ok).toBe("boolean");
    expect(typeof body.db.latencyMs).toBe("number");
    expect(typeof body.updater.available).toBe("boolean");
    expect(body.db.ok).toBe(true);
  });

  it("/api/health/deep never leaks env/paths/secrets", async () => {
    const r = await call("/api/health/deep");
    const txt = JSON.stringify(r.body);
    expect(txt).not.toContain("NEXORA_");
    expect(txt).not.toContain("/var/");
    expect(txt).not.toContain("DATABASE_ENCRYPTION_KEY");
    expect(txt.toLowerCase()).not.toContain("license");
    expect(txt.toLowerCase()).not.toContain("psk");
  });
});
