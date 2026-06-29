/**
 * nexora-updater — minimal HTTP-over-unix-socket controller.
 *
 * Endpoints (all called from the backend container via /var/run/nexora-updater.sock):
 *   POST /apply   — snapshot → docker pull → compose up → healthcheck → rollback on fail
 *   GET  /status  — read job state (jobId=latest returns the most recent)
 *
 * Auth model: the socket is mounted into only the backend container with
 * mode 0600 owned by the backend uid. No additional secret is checked.
 *
 * Concurrency: one job at a time. A second /apply while a job is running
 * returns 409.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyRequest } from "./handshake.ts";
import { encryptFileInPlace, type KeyMaterial } from "./snapshot-crypto.ts";

const SOCKET_PATH = process.env.SOCKET_PATH ?? "/var/run/nexora-updater.sock";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "/var/backups/nexora";
const COMPOSE_FILE = process.env.COMPOSE_FILE ?? "/nexora/docker-compose.yml";
const NEXORA_VOLUME = process.env.NEXORA_VOLUME ?? "nexora-db";
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "nexora";
// Deep health: verifies DB ping + schema version + updater socket.
// Plain /api/health is process-alive only — it would pass even if a schema
// rename broke every query. Dep is the right gate for "is the new image
// actually serving correctly".
const BACKEND_HEALTH_URL =
  process.env.BACKEND_HEALTH_URL ?? "http://nexora-backend:3000/api/health/deep";

mkdirSync(BACKUP_DIR, { recursive: true });
mkdirSync(dirname(SOCKET_PATH), { recursive: true });

type JobStatus =
  | "pending"
  | "snapshotting"
  | "pulling"
  | "swapping"
  | "healthchecking"
  | "ok"
  | "rolled-back"
  | "failed";

interface Job {
  id: string;
  status: JobStatus;
  fromVersion: string;
  toVersion: string;
  imageRepo: string;
  imageTag: string;
  sha256?: string;
  startedAt: number;
  finishedAt?: number;
  backupPath?: string;
  steps: Array<{ at: number; msg: string }>;
  error?: string;
}

let currentJob: Job | null = null;
const jobs = new Map<string, Job>();

function step(j: Job, msg: string): void {
  j.steps.push({ at: Date.now(), msg });
  // biome-ignore lint/suspicious/noConsole: structured operator log
  console.log(`[updater] [${j.id}] ${msg}`);
}

function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const t = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => {
      if (t) clearTimeout(t);
      resolve({ code: code ?? -1, stdout: out, stderr: err });
    });
  });
}

async function snapshotVolume(j: Job, keyMaterial: KeyMaterial | null): Promise<string> {
  step(j, `snapshot volume ${NEXORA_VOLUME}`);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const plainName = `${j.fromVersion}-${ts}.tar.gz`;
  const plainPath = join(BACKUP_DIR, plainName);
  const r = await run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${PROJECT}_${NEXORA_VOLUME}:/data:ro`,
      "-v",
      `${BACKUP_DIR}:/backup`,
      "alpine:3",
      "sh",
      "-c",
      `cd /data && tar czf /backup/${plainName} .`,
    ],
    { timeoutMs: 5 * 60_000 },
  );
  if (r.code !== 0) throw new Error(`snapshot failed: ${r.stderr || r.stdout}`);
  if (!keyMaterial) {
    step(j, `snapshot ok (unencrypted) → ${plainPath}`);
    return plainPath;
  }
  const encPath = join(BACKUP_DIR, `${j.fromVersion}-${ts}.nxs`);
  step(j, `encrypt snapshot → ${encPath}`);
  await encryptFileInPlace(plainPath, encPath, keyMaterial);
  step(j, `snapshot ok (encrypted) → ${encPath}`);
  return encPath;
}

async function pullImage(j: Job): Promise<void> {
  // Pin by digest when the manifest provided one. This protects against a
  // compromised GHCR account silently swapping a tag to point at a malicious
  // image — by-digest pulls fail if the digest no longer matches.
  const normalizedDigest = j.sha256
    ? j.sha256.startsWith("sha256:")
      ? j.sha256
      : `sha256:${j.sha256}`
    : null;
  const ref = normalizedDigest
    ? `${j.imageRepo}@${normalizedDigest}`
    : `${j.imageRepo}:${j.imageTag}`;
  step(j, `pull ${ref}`);
  const r = await run("docker", ["pull", ref], { timeoutMs: 15 * 60_000 });
  if (r.code !== 0) throw new Error(`pull failed: ${r.stderr || r.stdout}`);
  if (normalizedDigest) {
    // Re-tag so compose can refer to the version-tag we record in .env.version.
    const tagRef = `${j.imageRepo}:${j.imageTag}`;
    const t = await run("docker", ["tag", ref, tagRef]);
    if (t.code !== 0) throw new Error(`docker tag failed: ${t.stderr}`);
    const inspect = await run("docker", [
      "image",
      "inspect",
      "--format",
      "{{index .RepoDigests 0}}",
      tagRef,
    ]);
    if (inspect.code === 0 && !inspect.stdout.includes(normalizedDigest)) {
      throw new Error(`puled image digest mismatch (expected ${normalizedDigest})`);
    }
  }
  step(j, `pull ok`);
}

async function cleanupOldImage(j: Job): Promise<void> {
  if (!j.fromVersion || j.fromVersion === "unknown" || j.fromVersion === j.toVersion) return;
  const oldRef = `${j.imageRepo}:${j.fromVersion}`;
  step(j, `cleanup: rm ${oldRef}`);
  // Best-effort; do not fail the job if this errors (another container may still use it).
  const r = await run("docker", ["image", "rm", oldRef], { timeoutMs: 30_000 });
  if (r.code !== 0) {
    const firstLine = r.stderr.trim().split(String.fromCharCode(10))[0] ?? "";
    step(j, `cleanup: rm failed (non-fatal): ${firstLine}`);
  }
  await run("docker", ["image", "prune", "-f"], { timeoutMs: 60_000 });
  step(j, `cleanup ok`);
}

async function composeUp(j: Job, version: string): Promise<void> {
  step(j, `compose up @ ${version}`);
  const r = await run(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "up", "-d", "--no-deps", "backend", "frontend"],
    { timeoutMs: 5 * 60_000 },
  );
  if (r.code !== 0) throw new Error(`compose up failed: ${r.stderr || r.stdout}`);
}

async function waitHealthy(j: Job): Promise<boolean> {
  step(j, `healthcheck ${BACKEND_HEALTH_URL}`);
  // 120s deadline: cold-boot SQLite + migration + Astro SSR warmup can
  // exceed 60s on small VPS (the typical Nexora customer host).
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BACKEND_HEALTH_URL, { signal: AbortSignal.timeout(3_000) });
      if (r.ok) {
        // /api/health/deep returns 200 even when DB ping fails — body holds
        // the real verdict ({ok:false, db:{ok:false,error:...}}). Parse it
        // so a broken schema after update is caught (and triggers rollback)
        // instead of being recorded as a successful deploy.
        try {
          const body = (await r.json()) as { ok?: boolean; db?: { ok?: boolean } };
          if (body.ok === true && body.db?.ok === true) {
            step(j, `healthcheck ok (deep)`);
            return true;
          }
          // 200 but body says not ready — keep polling.
        } catch {
          // Body not JSON (shallow /api/health endpoint, or older build) —
          // fall back to status-only acceptance.
          step(j, `healthcheck ok (shallow)`);
          return true;
        }
      }
    } catch {
      // ignore until deadline
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

async function runJob(j: Job, km: KeyMaterial | null): Promise<void> {
  try {
    j.status = "snapshotting";
    j.backupPath = await snapshotVolume(j, km);

    j.status = "pulling";
    await pullImage(j);

    j.status = "swapping";
    // Atomically rewrite the version pin so compose picks up the new tag.
    writeFileSync(
      join(dirname(COMPOSE_FILE), ".env.version"),
      `NEXORA_IMAGE=${j.imageRepo}
NEXORA_VERSION=${j.imageTag}
`,
    );
    await composeUp(j, j.toVersion);

    j.status = "healthchecking";
    const healthy = await waitHealthy(j);
    if (!healthy) throw new Error("new version failed healthcheck");

    // Healthcheck passed — safe to reclaim space from the old image.
    await cleanupOldImage(j).catch((e) => step(j, `cleanup error (non-fatal): ${e}`));

    j.status = "ok";
    j.finishedAt = Date.now();
    step(j, `done`);
  } catch (e) {
    j.error = e instanceof Error ? e.message : String(e);
    step(j, `FAILED: ${j.error}`);
    // Rollback: re-pin previous version + compose up.
    try {
      step(j, `rollback to ${j.fromVersion}`);
      writeFileSync(
        join(dirname(COMPOSE_FILE), ".env.version"),
        `NEXORA_IMAGE=${j.imageRepo}
NEXORA_VERSION=${j.fromVersion}
`,
      );
      await composeUp(j, j.fromVersion);
      j.status = "rolled-back";
    } catch (re) {
      j.status = "failed";
      j.error += ` | rollback also failed: ${re instanceof Error ? re.message : String(re)}`;
    }
    j.finishedAt = Date.now();
  } finally {
    currentJob = null;
  }
}

// --- HTTP-over-unix-socket server ---------------------------------------
if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

Bun.serve({
  unix: SOCKET_PATH,
  async fetch(req) {
    const url = new URL(req.url);
    // Read raw body once so HMAC verification and JSON parse see the same bytes.
    const rawBody = req.method === "POST" ? await req.text() : "";
    const v = verifyRequest(req.headers, rawBody);
    if (!v.ok) {
      // biome-ignore lint/suspicious/noConsole: operator-facing reject log
      console.warn(`[updater] reject ${req.method} ${url.pathname}: ${v.reason}`);
      return json({ error: "handshake failed", reason: v.reason }, 401);
    }
    if (req.method === "POST" && url.pathname === "/apply") {
      if (currentJob) return json({ error: "job in progress", jobId: currentJob.id }, 409);
      let body: {
        targetVersion?: string;
        imageRepo?: string;
        imageTag?: string;
        sha256?: string;
        requestedBy?: string;
        licenseSecret?: string;
        machineId?: string;
      };
      try {
        body = JSON.parse(rawBody || "{}");
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body.targetVersion || !body.imageRepo || !body.imageTag) {
        return json({ error: "missing fields" }, 400);
      }
      const km: KeyMaterial | null =
        body.licenseSecret && body.machineId
          ? { licenseSecret: body.licenseSecret, machineId: body.machineId }
          : null;
      const fromVersion = readCurrentVersion();
      const id = `job-${Date.now()}`;
      const j: Job = {
        id,
        status: "pending",
        fromVersion,
        toVersion: body.targetVersion,
        imageRepo: body.imageRepo,
        imageTag: body.imageTag,
        sha256: body.sha256,
        startedAt: Date.now(),
        steps: [],
      };
      jobs.set(id, j);
      currentJob = j;
      runJob(j, km); // fire and forget
      return json({ jobId: id, status: j.status, encrypted: !!km });
    }
    if (req.method === "POST" && url.pathname === "/warm-pull") {
      // Pre-update warm pull: docker-pull a target image WITHOUT swapping
      // anything. Lets the admin UI surface "binary ready, click apply to
      // swap" so the actual /apply turns the slowest step (image pull over
      // a slow link) into a no-op.
      //
      // Idempotent + cheap to retry. Does NOT touch the running stack.
      let body: { imageRepo?: string; imageTag?: string; sha256?: string };
      try {
        body = JSON.parse(rawBody || "{}");
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body.imageRepo || !body.imageTag) {
        return json({ error: "missing fields" }, 400);
      }
      const normalizedDigest = body.sha256
        ? body.sha256.startsWith("sha256:")
          ? body.sha256
          : `sha256:${body.sha256}`
        : null;
      const ref = normalizedDigest
        ? `${body.imageRepo}@${normalizedDigest}`
        : `${body.imageRepo}:${body.imageTag}`;
      const t0 = Date.now();
      const r = await run("docker", ["pull", ref], { timeoutMs: 15 * 60_000 });
      const elapsedMs = Date.now() - t0;
      if (r.code !== 0) {
        return json(
          {
            ok: false,
            error: "pull failed",
            detail: (r.stderr || r.stdout).trim().split(String.fromCharCode(10))[0] ?? "",
            elapsedMs,
          },
          502,
        );
      }
      // Verify digest if pinned.
      let digestVerified: string | null = null;
      if (normalizedDigest) {
        const inspect = await run("docker", [
          "image",
          "inspect",
          "--format",
          "{{index .RepoDigests 0}}",
          ref,
        ]);
        if (inspect.code === 0 && inspect.stdout.includes(normalizedDigest)) {
          digestVerified = normalizedDigest;
        } else {
          return json(
            {
              ok: false,
              error: "digest mismatch",
              expected: normalizedDigest,
              elapsedMs,
            },
            409,
          );
        }
      }
      return json({ ok: true, ref, digestVerified, elapsedMs });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      const id = url.searchParams.get("jobId");
      const j =
        id && id !== "latest"
          ? (jobs.get(id) ?? null)
          : ([...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null);
      if (!j) return json({ error: "no jobs" }, 404);
      return json(j);
    }
    return json({ error: "not found" }, 404);
  },
});

// biome-ignore lint/suspicious/noConsole: boot log
console.log(`[updater] listening on ${SOCKET_PATH}`);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readCurrentVersion(): string {
  const path = join(dirname(COMPOSE_FILE), ".env.version");
  if (!existsSync(path)) return "unknown";
  const txt = readFileSync(path, "utf8");
  const m = txt.match(/^NEXORA_VERSION=(.+)$/m);
  return m ? m[1].trim() : "unknown";
}
