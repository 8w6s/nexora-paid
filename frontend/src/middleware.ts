import { defineMiddleware } from "astro:middleware";

const API_ORIGIN = import.meta.env.PUBLIC_API_ORIGIN || "http://localhost:3000";

// Paths that must stay reachable even before setup is done.
const ALLOW = [/^\/setup(\/|$)/, /^\/_/, /^\/favicon/, /\.[a-z0-9]+$/i];

// Server-side setup guard: while the store has no admin yet, every page request is redirected
// to /setup. This makes the clone-and-run flow foolproof — a freshly cloned shop forces the
// owner through setup no matter which URL they hit. Cached briefly to avoid hammering the API.
let cache: { needsSetup: boolean; at: number } | null = null;
const TTL = 5000;

async function needsSetup(): Promise<boolean | null> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.needsSetup;
  try {
    // Short retry lop — when both backend + frontend start in the same
    // container, the SSR sometimes hits the API before it has bound. A
    // few quick retries beats falsely deciding "no setup needed" and
    // serving / instead of /setup.
    let lastErr: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch(`${API_ORIGIN}/api/setup/status`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(2000),
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as { needsSetup?: boolean };
        cache = { needsSetup: !!j.needsSetup, at: now };
        return cache.needsSetup;
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 300 + i * 200));
      }
    }
    console.warn("[middleware] needsSetup probe failed after retries:", lastErr);
    // API truly unreachable — leave cache untouched and return null so the
    // caller decides what to do (we render the 503 page instead of silently
    // serving an empty store).
    return null;
  } catch {
    return null;
  }
}

// f-frontend-1 (deep audit, 2026-06-27): set baseline security headers on every
// Astro response. Without these:
//   1. Clickjacking: the admin /account page can be iframed by a hostile site.
//      sameSite=strict on the session cookie blunts most CSRF impact but the
//      visible-UI tricks (transparent overlay + invisible click) remain.
//   2. Referrer leak: a reset link like /reset?token=XXX exposes the token to
//      every outbound link the user clicks while on that page (analytics, CDN,
//      any cross-origin href).
//   3. MIME sniffing: an attacker who uploads a polyglot file can serve it as
//      script if no nosniff is set.
//   4. No defense-in-depth against XSS: if a stored-XSS slips past sanitize-html
//      anywhere in the storefront, a CSP that blocks inline-eval (we use Astro
//      hydration islands so inline IS still needed — keep 'unsafe-inline'
//      pragmatically) at least restricts exfil to same-origin.
//
// These headers are append-only — they don't change route logic. Tight enough
// to add value, loose enough not to break the existing Astro + React hydration
// pipeline (which needs inline script for islands and inline style for
// CSS-in-JS-style component scoping). Tighten further once an audit confirms
// the inline policy is no longer needed.
function applySecurityHeaders(response: Response): Response {
  const h = response.headers;
  if (!h.has("X-Frame-Options")) h.set("X-Frame-Options", "DENY");
  if (!h.has("X-Content-Type-Options")) h.set("X-Content-Type-Options", "nosniff");
  if (!h.has("Referrer-Policy")) h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!h.has("Permissions-Policy")) {
    h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  }
  return response;
}

// Combined image runs backend on :3000 and frontend on :4321 inside the
// same container, but the customer's host only exposes :4321 (the frontend).
// Without a reverse proxy, browser-side fetch('/api/...') hits Astro instead
// of the backend and 404s. We proxy /api/* through Astro SSR to the backend
// on localhost:3000 so the customer's docker-compose only needs to expose
// the frontend port.
const BACKEND_INTERNAL = process.env.NEXORA_BACKEND_INTERNAL || "http://localhost:3000";

async function proxyToBackend(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = BACKEND_INTERNAL + url.pathname + url.search;
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: "manual",
  };
  try {
    const r = await fetch(target, init);
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "backend unreachable", code: "BACKEND_DOWN" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  // Proxy every /api/* call through to the backend service in the same
  // container. Path-only, headers + body pass through.
  if (path.startsWith("/api/")) {
    return proxyToBackend(ctx.request);
  }
  if (ALLOW.some((re) => re.test(path))) return applySecurityHeaders(await next());
  const verdict = await needsSetup();
  if (verdict === true) return ctx.redirect("/setup", 302);
  if (verdict === null) {
    // API unreachable — likely backend hasn't bound yet right after compose up.
    // Return a friendly 503 instead of a hollow shell that confuses the user.
    return new Response(
      "Nexora API is starting — refresh in a few seconds.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "5" } },
    );
  }
  return applySecurityHeaders(await next());
});
