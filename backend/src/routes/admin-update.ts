import { existsSync } from "node:fs";
import { Elysia, t } from "elysia";
import { verifySignedManifest } from "../../../updater/manifest-verify.ts";
import { APP_VERSION } from "../lib/app-version.ts";
import { SESSION_COOKIE, validateSession } from "../lib/auth.ts";
import { degradedGate } from "../lib/integrity-state.ts";
import { clientIp, rateLimitCheck } from "../lib/rate-limit.ts";
import { ensureMachineId, readLicenseSecret } from "../lib/tenant.ts";
import { signRequest } from "../lib/updater-handshake.ts";

const FILESERVER_URL =
  Bun.env.NEXORA_FILESERVER_URL ?? "https://raw.githubusercontent.com/8w6s/nexora-releases/main";
const UPDATE_CHANNEL = Bun.env.NEXORA_UPDATE_CHANNEL ?? "stable";

// In-process cache: avoid hammering FileServer on every admin tab refresh.
let cached: { at: number; payload: any } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface VersionManifest {
  latest: string;
  min: string;
  channel: string;
  imageRepo: string;
  imageTag: string;
  sha256?: string;
  changelogUrl?: string;
  publishedAt?: string;
  notes?: string;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

// Signed-manifest rollout flag. With NEXORA_REQUIRE_SIGNED=1 we fetch
// versions/<channel>.signed.json and refuse to proceed if the ed25519
// signature does not verify (see updater/manifest-verify.ts).
// Default off so v1.0 customers whose FileServer still publishes plain
// .json don't break before the signed-publish pipeline lands.
const REQUIRE_SIGNED = Bun.env.NEXORA_REQUIRE_SIGNED === "1";

async function fetchManifest(): Promise<VersionManifest> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;
  // Two URL shapes supported:
  //   - Raw GitHub:     {FILESERVER_URL}/versions/{channel}.json
  //   - Hosted server:  {FILESERVER_URL}/v1/version?channel={channel}
  const isRaw = /raw\.githubusercontent\.com/.test(FILESERVER_URL);
  const ext = REQUIRE_SIGNED ? ".signed.json" : ".json";
  const url = isRaw
    ? `${FILESERVER_URL}/versions/${encodeURIComponent(UPDATE_CHANNEL)}${ext}`
    : `${FILESERVER_URL}/v1/version?channel=${encodeURIComponent(UPDATE_CHANNEL)}${REQUIRE_SIGNED ? "&signed=1" : ""}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": `nexora/${APP_VERSION}` },
  });
  if (!r.ok) throw new Error(`fileserver ${r.status}`);
  const raw = await r.json();
  let payload: VersionManifest;
  if (REQUIRE_SIGNED) {
    const v = verifySignedManifest(raw);
    if (!v.ok || !v.payload) {
      throw new Error(`signed manifest rejected: ${v.reason ?? "unknown"}`);
    }
    // The signed shape's payload only carries the fields we control at
    // signing time; fall back to defaults for `min` / `channel` so the
    // downstream consumer (cmpSemver) still has them.
    payload = {
      latest: v.payload.latest,
      min: v.payload.min ?? v.payload.latest,
      channel: v.payload.channel ?? UPDATE_CHANNEL,
      imageRepo: v.payload.imageRepo,
      imageTag: v.payload.imageTag,
      sha256: v.payload.sha256,
      changelogUrl: v.payload.changelogUrl,
      publishedAt: v.payload.publishedAt,
      notes: v.payload.notes,
    };
  } else {
    payload = raw as VersionManifest;
    if (!payload.latest || !payload.imageRepo) throw new Error("invalid manifest");
  }
  cached = { at: Date.now(), payload };
  return payload;
}

export const adminUpdateRoutes = new Elysia({ prefix: "/api/admin/update" })
  .derive(async ({ cookie, set }) => {
    const u = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
    if (u?.role !== "admin") {
      set.status = 401;
      return { __unauthorized: true as const, user: null };
    }
    return { __unauthorized: false as const, user: u };
  })
  .onBeforeHandle(({ __unauthorized }) => {
    if (__unauthorized) return { error: "Unauthorized", code: "UNAUTHORIZED" };
    return undefined;
  })
  .onBeforeHandle(degradedGate)

  // GET /api/admin/update/check — query FileServer, compare against current.
  .get("/check", async ({ request, set }) => {
    const ip = clientIp(request);
    const rl = rateLimitCheck(`admin-update-check:${ip}`, 12, 60_000);
    if (!rl.allowed) {
      set.status = 429;
      return { error: "Too many requests", code: "RATE_LIMITED" };
    }
    try {
      const m = await fetchManifest();
      const updateAvailable = cmpSemver(m.latest, APP_VERSION) > 0;
      const blockedByMin = cmpSemver(APP_VERSION, m.min) < 0;
      return {
        current: APP_VERSION,
        latest: m.latest,
        minSupported: m.min,
        channel: m.channel,
        updateAvailable,
        blockedByMin,
        imageRepo: m.imageRepo,
        imageTag: m.imageTag,
        sha256: m.sha256 ?? null,
        changelogUrl: m.changelogUrl ?? null,
        publishedAt: m.publishedAt ?? null,
        notes: m.notes ?? null,
        canApply: updateAvailable && supportsInPlaceApply(),
      };
    } catch (e) {
      set.status = 502;
      return {
        error: "Could not reach update server",
        code: "FILESERVER_UNREACHABLE",
        detail: e instanceof Error ? e.message : String(e),
        current: APP_VERSION,
      };
    }
  })

  // POST /api/admin/update/apply — orchestrate snapshot + pull + restart.
  // Returns immediately with a jobId; actual swap happens via the host-side
  // updater script (mounted into the backend container as a unix socket).
  .post(
    "/apply",
    async ({ body, request, set, user }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`admin-update-apply:${ip}`, 3, 5 * 60_000);
      if (!rl.allowed) {
        set.status = 429;
        return { error: "Too many requests", code: "RATE_LIMITED" };
      }
      if (!supportsInPlaceApply()) {
        set.status = 501;
        return {
          error: "In-place apply not configured on this host",
          code: "APPLY_NOT_SUPPORTED",
          hint: "Mount the host updater socket at /var/run/nexora-updater.sock and re-run.",
        };
      }
      let manifest: VersionManifest;
      try {
        manifest = await fetchManifest();
      } catch {
        set.status = 502;
        return { error: "Could not reach update server", code: "FILESERVER_UNREACHABLE" };
      }
      if (cmpSemver(manifest.latest, APP_VERSION) <= 0) {
        set.status = 400;
        return { error: "Already up to date", code: "NO_UPDATE" };
      }
      if (body?.expectVersion && body.expectVersion !== manifest.latest) {
        set.status = 409;
        return {
          error: `Version drifted (expected ${body.expectVersion}, latest now ${manifest.latest})`,
          code: "VERSION_DRIFT",
        };
      }
      try {
        // Try to attach key material so the updater can encrypt the snapshot.
        // Missing license/machine-id is non-fatal: snapshot will be written
        // as plain .tar.gz and a warning logged.
        let licenseSecret: string | undefined;
        let machineId: string | undefined;
        try {
          licenseSecret = readLicenseSecret();
          machineId = ensureMachineId();
        } catch (e) {
          // biome-ignore lint/suspicious/noConsole: operator-facing warning on degraded path
          console.warn("[admin-update] snapshot will be unencrypted:", e);
        }
        const bodyStr = JSON.stringify({
          targetVersion: manifest.latest,
          imageRepo: manifest.imageRepo,
          imageTag: manifest.imageTag,
          sha256: manifest.sha256,
          requestedBy: user?.email ?? "admin",
          licenseSecret,
          machineId,
        });
        let authHeaders: Record<string, string>;
        try {
          authHeaders = signRequest(bodyStr);
        } catch (e) {
          set.status = 500;
          return {
            error: "Updater PSK not configured",
            code: "UPDATER_PSK_MISSING",
            detail: e instanceof Error ? e.message : String(e),
          };
        }
        const r = await fetch("http://unix/apply", {
          method: "POST",
          unix: "/var/run/nexora-updater.sock",
          headers: { "content-type": "application/json", ...authHeaders },
          body: bodyStr,
          signal: AbortSignal.timeout(5_000),
        } as RequestInit & { unix: string });
        const data = (await r.json().catch(() => ({}))) as { jobId?: string; status?: string };
        if (!r.ok) {
          set.status = 500;
          return { error: "Updater rejected the request", code: "UPDATER_REJECTED", detail: data };
        }
        return {
          ok: true,
          jobId: data.jobId,
          targetVersion: manifest.latest,
          message: "Snapshot taken, image pulling. Service will restart shortly.",
        };
      } catch (e) {
        set.status = 500;
        return {
          error: "Could not contact host updater",
          code: "UPDATER_UNREACHABLE",
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    },
    {
      body: t.Object({
        expectVersion: t.Optional(t.String({ maxLength: 32 })),
      }),
    },
  )

  // POST /api/admin/update/warm-pull — pull image early without swapping.
  // Lets the admin click "Prepare update" while traffic is still hitting
  // the old version, so the eventual /apply skips the slow docker-pull.
  .post("/warm-pull", async ({ request, set }) => {
    const ip = clientIp(request);
    const rl = rateLimitCheck(`admin-update-warm:${ip}`, 6, 60_000);
    if (!rl.allowed) {
      set.status = 429;
      return { error: "Too many requests", code: "RATE_LIMITED" };
    }
    if (!supportsInPlaceApply()) {
      set.status = 501;
      return { error: "Updater not configured", code: "APPLY_NOT_SUPPORTED" };
    }
    let manifest: VersionManifest;
    try {
      manifest = await fetchManifest();
    } catch {
      set.status = 502;
      return { error: "Could not reach update server", code: "FILESERVER_UNREACHABLE" };
    }
    if (cmpSemver(manifest.latest, APP_VERSION) <= 0) {
      set.status = 400;
      return { error: "Already up to date", code: "NO_UPDATE" };
    }
    const bodyStr = JSON.stringify({
      imageRepo: manifest.imageRepo,
      imageTag: manifest.imageTag,
      sha256: manifest.sha256,
    });
    let authHeaders: Record<string, string>;
    try {
      authHeaders = signRequest(bodyStr);
    } catch (e) {
      set.status = 500;
      return {
        error: "Updater PSK not configured",
        code: "UPDATER_PSK_MISSING",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    try {
      const r = await fetch("http://unix/warm-pull", {
        method: "POST",
        unix: "/var/run/nexora-updater.sock",
        headers: { "content-type": "application/json", ...authHeaders },
        body: bodyStr,
        signal: AbortSignal.timeout(16 * 60_000),
      } as RequestInit & { unix: string });
      const data = (await r.json().catch(() => ({}))) as {
        digestVerified?: boolean;
        elapsedMs?: number;
      };
      if (!r.ok) {
        set.status = r.status;
        return { error: "Warm-pull failed", code: "WARM_PULL_FAILED", detail: data };
      }
      return {
        ok: true,
        targetVersion: manifest.latest,
        imageRepo: manifest.imageRepo,
        imageTag: manifest.imageTag,
        digestVerified: data.digestVerified ?? null,
        elapsedMs: data.elapsedMs ?? null,
      };
    } catch (e) {
      set.status = 502;
      return {
        error: "Could not reach updater",
        code: "UPDATER_UNREACHABLE",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  })

  // GET /api/admin/update/status — read job state from host updater.
  .get("/status", async ({ query, set }) => {
    if (!supportsInPlaceApply()) {
      set.status = 501;
      return { error: "Updater not configured", code: "APPLY_NOT_SUPPORTED" };
    }
    try {
      const id = query?.jobId ?? "latest";
      const r = await fetch(`http://unix/status?jobId=${encodeURIComponent(id)}`, {
        unix: "/var/run/nexora-updater.sock",
        signal: AbortSignal.timeout(5_000),
      } as RequestInit & { unix: string });
      if (!r.ok) {
        set.status = r.status;
        return { error: "Updater error", code: "UPDATER_ERROR" };
      }
      return await r.json();
    } catch (e) {
      set.status = 502;
      return {
        error: "Could not reach updater",
        code: "UPDATER_UNREACHABLE",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  });

function supportsInPlaceApply(): boolean {
  // The host-side updater container mounts this socket into the backend.
  // Absent socket → in-place apply unavailable; admin must update manually.
  return existsSync("/var/run/nexora-updater.sock");
}
