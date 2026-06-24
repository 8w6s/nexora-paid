/**
 * nexora-fileserver — stateless version + license verify service.
 *
 * Reads its source-of-truth from a GitHub repo (NEXORA_RELEASES_REPO):
 *   versions/{channel}.json   { latest, min, imageRepo, imageTag, sha256, ... }
 *   revoked.json              { revoked: ["licenseId1", "licenseId2"] }
 *   changelog/{version}.md
 *
 * No DB. In-memory cache with 5 min TTL. Public GET endpoints; license verify
 * is also unauthenticated since it only reads public signing material.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (!ed.hashes.sha512) ed.hashes.sha512 = (m: Uint8Array) => sha512(m);

const PORT = Number(Bun.env.PORT ?? 8080);
const RELEASES_REPO = Bun.env.NEXORA_RELEASES_REPO ?? "8w6s/nexora-releases";
const RELEASES_BRANCH = Bun.env.NEXORA_RELEASES_BRANCH ?? "main";
const GITHUB_TOKEN = Bun.env.GITHUB_TOKEN ?? "";
const LICENSE_PUBKEY_HEX =
  Bun.env.LICENSE_PUBKEY_HEX ?? "b20fc9037c686ef41ae162dc95f95a7ce16f7557d5c4884d8f28eed17aec44e3";

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: any }>();

async function fetchGitHub(path: string, asJson: boolean): Promise<any> {
  const key = `gh:${path}:${asJson ? "json" : "raw"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const url = `https://raw.githubusercontent.com/${RELEASES_REPO}/${RELEASES_BRANCH}/${path}`;
  const r = await fetch(url, {
    headers: GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {},
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`github ${r.status} for ${path}`);
  const data = asJson ? await r.json() : await r.text();
  cache.set(key, { at: Date.now(), data });
  return data;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "").toLowerCase();
  if (clean.length % 2 !== 0) throw new Error("bad hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function safeUtf8(s: string): string {
  return s.replace(/[\x00-\x1F\x7F]/g, " ").slice(0, 4096);
}

const ipBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || b.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

function json(payload: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const ip = clientIp(req);

    // ── GET /v1/health ────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json({ ok: true });
    }

    // ── GET /v1/version?channel=stable ────────────────────────────────
    if (req.method === "GET" && url.pathname === "/v1/version") {
      if (!rateLimit(`ver:${ip}`, 60, 60_000)) return json({ error: "rate limited" }, 429);
      const channel = (url.searchParams.get("channel") ?? "stable").replace(/[^a-z0-9-]/gi, "");
      try {
        const data = await fetchGitHub(`versions/${channel}.json`, true);
        return json(data);
      } catch (e) {
        return json({ error: "channel not found", channel }, 404);
      }
    }

    // ── GET /v1/changelog/:version ────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/v1/changelog/")) {
      if (!rateLimit(`cl:${ip}`, 60, 60_000)) return json({ error: "rate limited" }, 429);
      const ver = url.pathname.slice("/v1/changelog/".length).replace(/[^a-z0-9.\-_]/gi, "");
      if (!ver) return json({ error: "missing version" }, 400);
      try {
        const md = (await fetchGitHub(`changelog/${ver}.md`, false)) as string;
        return new Response(md, {
          headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" },
        });
      } catch {
        return json({ error: "changelog not found", version: ver }, 404);
      }
    }

    // ── POST /v1/license/verify ───────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/v1/license/verify") {
      if (!rateLimit(`lic:${ip}`, 30, 60_000)) return json({ error: "rate limited" }, 429);
      let body: { licenseFile?: string; machineId?: string };
      try {
        body = await req.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      const lic = safeUtf8(body.licenseFile ?? "");
      const machineId = safeUtf8(body.machineId ?? "").slice(0, 256);
      if (!lic) return json({ error: "missing licenseFile" }, 400);

      // license file format: base64(JSON({payload, signature}))
      let parsed: { payload?: any; signature?: string };
      try {
        const txt = Buffer.from(lic, "base64").toString("utf8");
        parsed = JSON.parse(txt);
      } catch {
        return json({ valid: false, reason: "malformed" }, 200);
      }
      if (!parsed.payload || !parsed.signature) return json({ valid: false, reason: "shape" });

      const msg = new TextEncoder().encode(JSON.stringify(parsed.payload));
      let sigOk = false;
      try {
        sigOk = await ed.verifyAsync(hexToBytes(parsed.signature), msg, hexToBytes(LICENSE_PUBKEY_HEX));
      } catch {
        sigOk = false;
      }
      if (!sigOk) return json({ valid: false, reason: "signature" });

      const p = parsed.payload as {
        licenseId?: string;
        email?: string;
        productId?: string;
        expiresAt?: string;
        features?: string[];
      };
      if (p.expiresAt && new Date(p.expiresAt).getTime() < Date.now()) {
        return json({ valid: false, reason: "expired", expiresAt: p.expiresAt });
      }

      try {
        const r = (await fetchGitHub("revoked.json", true)) as { revoked?: string[] };
        if (p.licenseId && r.revoked?.includes(p.licenseId)) {
          return json({ valid: false, reason: "revoked", licenseId: p.licenseId });
        }
      } catch {
        // Revocation list missing → fail open (license still verified by signature).
      }

      console.log(
        `[lic] verify ok licenseId=${p.licenseId ?? "?"} email=${p.email ?? "?"} machine=${machineId.slice(0, 16)} ip=${ip}`,
      );
      return json({
        valid: true,
        licenseId: p.licenseId ?? null,
        email: p.email ?? null,
        productId: p.productId ?? null,
        expiresAt: p.expiresAt ?? null,
        features: p.features ?? null,
      });
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`[fileserver] listening on :${PORT} repo=${RELEASES_REPO}@${RELEASES_BRANCH}`);