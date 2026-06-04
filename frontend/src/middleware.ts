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
    const r = await fetch(`${API_ORIGIN}/api/setup/status`, { headers: { accept: "application/json" } });
    const j = (await r.json()) as { needsSetup?: boolean };
    cache = { needsSetup: !!j.needsSetup, at: now };
  } catch {
    cache = { needsSetup: false, at: now }; // API down → don't trap the user
  }
  return cache.needsSetup;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  if (ALLOW.some((re) => re.test(path))) return next();
  if (await needsSetup()) return ctx.redirect("/setup", 302);
  return next();
});
