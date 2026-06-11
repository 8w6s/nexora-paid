import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes, bootstrapAdmin } from "./routes/auth.ts";
import { primeOrderTokenSecret } from "./lib/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { adminTicketRoutes } from "./routes/tickets.ts";
import { checkoutRoutes } from "./routes/checkout.ts";
import { setupRoutes } from "./routes/setup.ts";
import { reviewRoutes } from "./routes/reviews.ts";
import { ticketRoutes } from "./routes/tickets.ts";
import { configRoutes } from "./routes/config.ts";
import { productRoutes } from "./routes/products.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { startWatcher, recoverStuckOrders, onOrderDelivered } from "./lib/watcher.ts";
import { EmailService } from "./lib/email.ts";
import { loadPlugins } from "./lib/plugin/loader.ts";
import { logger } from "./lib/logger.ts";

const PUBLIC_ORIGIN = Bun.env.PUBLIC_ORIGIN ?? "http://localhost:4321";

// Production hardening: refuse to boot with insecure defaults that work fine in dev
// but are catastrophic when exposed to the open internet.
if (Bun.env.NODE_ENV === "production") {
  if (!Bun.env.PUBLIC_ORIGIN) {
    console.error("[boot] FATAL: NODE_ENV=production but PUBLIC_ORIGIN is not set — refusing to start.");
    process.exit(1);
  }
  if (!PUBLIC_ORIGIN.startsWith("https://")) {
    console.error(`[boot] FATAL: PUBLIC_ORIGIN must use HTTPS in production (got "${PUBLIC_ORIGIN}").`);
    process.exit(1);
  }
  if (!Bun.env.ORDER_TOKEN_SECRET || Bun.env.ORDER_TOKEN_SECRET.length < 32) {
    console.warn("[boot] WARNING: ORDER_TOKEN_SECRET unset or short — falling back to DB-stored random secret.");
  }
}

// X-Forwarded-* trust gate: only honor proxy headers when explicitly told the
// app sits behind a reverse proxy. Default = ignore them so an attacker can't
// spoof their client IP to bypass per-IP rate limits.
const TRUST_PROXY = (Bun.env.TRUST_PROXY ?? "").toLowerCase() === "true";
(globalThis as any).__nexora_trust_proxy = TRUST_PROXY;

// Free-tier app: every route in the Free baseline is chained here. Paid
// modules are loaded right before `.listen()` via `loadPaidModules()` so a
// Free build (with an empty registry) is byte-identical to "no Paid wiring".
const baseApp = new Elysia()
  // CORS for cookie auth: explicit origin + credentials (no wildcard).
  .use(cors({ origin: PUBLIC_ORIGIN, credentials: true }))
  // CSRF defense-in-depth: reject cross-origin state-changing requests.
  // Strengthened post-pentest:
  //   1. If Origin is missing AND Referer is also missing on a state-changing
  //      request, refuse — a same-origin browser request always sends Origin
  //      for fetch/XHR; a missing one usually means a curl-style attack.
  //   2. Cross-check Referer when present so a malicious site can't omit
  //      Origin to slip past.
  .onBeforeHandle(({ request, set }) => {
    if (request.method === "GET" || request.method === "HEAD") return;
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (origin) {
      if (origin !== PUBLIC_ORIGIN) {
        set.status = 403;
        return { error: "Bad origin", code: "BAD_ORIGIN" };
      }
    } else if (referer) {
      try {
        const r = new URL(referer);
        const expected = new URL(PUBLIC_ORIGIN);
        if (r.origin !== expected.origin) {
          set.status = 403;
          return { error: "Bad referer", code: "BAD_REFERER" };
        }
      } catch {
        set.status = 403;
        return { error: "Bad referer", code: "BAD_REFERER" };
      }
    } else {
      // Neither Origin nor Referer — refuse for state-changing requests.
      // Browsers always send at least one for fetch/XHR with credentials.
      set.status = 403;
      return { error: "Missing origin", code: "NO_ORIGIN" };
    }
    return;
  })
  // Generic security headers for every response. CORS already added above
  // takes care of cross-origin; these protect the response itself.
  // - nosniff: block MIME-sniffing (force browser to honor declared content-type).
  // - referrer-policy: never leak URLs (incl. order tokens) in Referer header.
  // - x-frame-options: block all framing (clickjacking on /api responses).
  // - permissions-policy: deny powerful browser APIs we never need.
  // - cross-origin-resource-policy: same-site so other origins can't read JSON.
  // - cross-origin-opener-policy: same-origin keeps browsing contexts isolated.
  // - content-security-policy: this API only ever returns JSON. A strict CSP on
  //   the response itself is a belt-and-braces defense against an XSS vector
  //   that smuggles HTML through a misconfigured route — the policy below
  //   blocks every script + frame source so even a hostile JSON-rendered-as-HTML
  //   response can't execute inline JS.
  // - strict-transport-security: only meaningful over HTTPS. We add it
  //   unconditionally in production; in dev we skip it so http://localhost
  //   keeps working.
  .onAfterHandle(({ set }) => {
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["referrer-policy"] = "no-referrer";
    set.headers["x-frame-options"] = "DENY";
    set.headers["permissions-policy"] = "geolocation=(), microphone=(), camera=(), usb=(), payment=(), midi=()";
    set.headers["cross-origin-resource-policy"] = "same-site";
    set.headers["cross-origin-opener-policy"] = "same-origin";
    set.headers["content-security-policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    if (Bun.env.NODE_ENV === "production") {
      set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains; preload";
    }
  })

  .get("/api/health", () => ({ ok: true }))

  // ───── Public routes (no auth required) ─────
  .use(configRoutes)
  .use(productRoutes)
  .use(categoryRoutes)

  // ───── Auth + customer routes ─────
  .use(authRoutes)
  .use(reviewRoutes)
  .use(ticketRoutes)

  // ───── Admin routes ─────
  .use(adminRoutes)
  .use(adminTicketRoutes)

  // ───── Checkout + setup ─────
  .use(checkoutRoutes)
  .use(setupRoutes);

// Paid modules register here (gated by license). Empty registry = no-op.
const app = await loadPlugins(baseApp);

// Bootstrap admin + prime crypto secrets BEFORE we listen() so the very first
// request can never observe the throw-on-uninitialized branch in
// generateOrderToken. Previously this ran post-listen and there was a sliver
// of a window where /api/checkout could 500 instead of returning a token.
await bootstrapAdmin();
await primeOrderTokenSecret();

app.listen(Number(Bun.env.PORT ?? 3000));

console.log(`Nexora API running at http://localhost:${Bun.env.PORT ?? 3000}`);
console.log(`CORS origin: ${PUBLIC_ORIGIN}`);

// Best-effort email on delivery (no-op unless email is configured in settings/env).
onOrderDelivered((orderId, email, keys) => {
  EmailService.deliveredKeys(orderId, email, keys).then((r) => {
    if ("error" in r) console.warn(`[email] order ${orderId} send failed: ${r.error}`);
    else if ("id" in r) console.log(`[email] delivered-keys sent for ${orderId} (${r.id})`);
  });
});

await recoverStuckOrders();
startWatcher();

export type App = typeof app;