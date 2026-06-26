import { defineMiddleware } from "astro:middleware";

const API_ORIGIN = import.meta.env.PUBLIC_API_ORIGIN || "http://localhost:3000";

// Paths that must stay reachable even before setup is done.
const ALLOW = [/^\/setup(\/|$)/, /^\/_/, /^\/favicon/, /\.[a-z0-9]+$/i];

// Server-side setup guard: while the store has no admin yet, every page request is redirected
// to /setup. This makes the clone-and-run flow foolproof — a freshly cloned shop forces the
// owner through setup no matter which URL they hit. Cached briefly to avoid hammering the API.
let cache: { needsSetup: boolean; at: number } | null = null;
const TTL = 5000;

async function needsSetup(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.needsSetup;
  try {
    const r = await fetch(`${API_ORIGIN}/api/setup/status`, {
      headers: { accept: "application/json" },
    });
    const j = (await r.json()) as { needsSetup?: boolean };
    cache = { needsSetup: !!j.needsSetup, at: now };
  } catch {
    cache = { needsSetup: false, at: now }; // API down → don't trap the user
  }
  return cache.needsSetup;
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

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  if (ALLOW.some((re) => re.test(path))) return applySecurityHeaders(await next());
  if (await needsSetup()) return ctx.redirect("/setup", 302);
  return applySecurityHeaders(await next());
});
