import { cors } from "@elysiajs/cors";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "./db/connection.ts";
import { orders } from "./db/schema.ts";
import {
  primeOrderTokenSecret,
  SESSION_COOKIE,
  validateSession,
  verifyOrderToken,
} from "./lib/auth.ts";
import { printBootBanner } from "./lib/banner.ts";
import { EmailService } from "./lib/email.ts";
import { initIntegrity, toBannerInfo } from "./lib/integrity-state.ts";
import { loadPlugins } from "./lib/plugin/loader.ts";
import { clientIp, rateLimitCheck } from "./lib/rate-limit.ts";
import { onOrderDelivered, recoverStuckOrders, startWatcher } from "./lib/watcher.ts";
import { adminRoutes } from "./routes/admin.ts";
import { admin2faRoutes } from "./routes/admin-2fa.ts";
import { adminBlocklistRoutes } from "./routes/admin-blocklist.ts";
import { adminDbRoutes } from "./routes/admin-db.ts";
import { adminTablesRoutes } from "./routes/admin-tables.ts";
import { adminUpdateRoutes } from "./routes/admin-update.ts";
import { authRoutes, bootstrapAdmin } from "./routes/auth.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { checkoutRoutes } from "./routes/checkout.ts";
import { configRoutes } from "./routes/config.ts";
import { customer2faRoutes } from "./routes/customer-2fa.ts";
import { devRoutes } from "./routes/dev.ts";
import { healthRoutes } from "./routes/health.ts";
import { clearCatalogCache, productRoutes } from "./routes/products.ts";
import { reviewRoutes } from "./routes/reviews.ts";
import { setupRoutes } from "./routes/setup.ts";
import { adminTicketRoutes, ticketRoutes } from "./routes/tickets.ts";

const PUBLIC_ORIGIN = Bun.env.PUBLIC_ORIGIN ?? "http://localhost:4321";

// Production hardening: refuse to boot with insecure defaults that work fine in dev
// but are catastrophic when exposed to the open internet.
if (Bun.env.NODE_ENV === "production") {
  if (!Bun.env.PUBLIC_ORIGIN) {
    console.error(
      "[boot] FATAL: NODE_ENV=production but PUBLIC_ORIGIN is not set — refusing to start.",
    );
    process.exit(1);
  }
  if (!PUBLIC_ORIGIN.startsWith("https://")) {
    console.error(
      `[boot] FATAL: PUBLIC_ORIGIN must use HTTPS in production (got "${PUBLIC_ORIGIN}").`,
    );
    process.exit(1);
  }
  if (!Bun.env.ORDER_TOKEN_SECRET || Bun.env.ORDER_TOKEN_SECRET.length < 32) {
    // Refuse to boot rather than fall back to a DB-stored secret in prod:
    // any DB read (offline backup leak, future SQLi, support engineer with
    // read-replica access) yields the HMAC key that signs guest order
    // capability tokens, letting an attacker forge ?token= for any
    // guessable order id and exfiltrate delivered keys.
    console.error(
      "[boot] FATAL: ORDER_TOKEN_SECRET must be set to a 32+ character random value in production.",
    );
    process.exit(1);
  }
}

// X-Forwarded-* trust gate: only honor proxy headers when explicitly told the
// app sits behind a reverse proxy. Default = ignore them so an attacker can't
// spoof their client IP to bypass per-IP rate limits.
const TRUST_PROXY = (Bun.env.TRUST_PROXY ?? "").toLowerCase() === "true";
(globalThis as any).__nexora_trust_proxy = TRUST_PROXY;

// Active SSE streams per concurrency key (userId for authed, IP for guests).
// Capped per-key in the /api/orders/:id/events handler so one client cannot
// open hundreds of streams (each holding a deliverHook subscription + a 30s
// heartbeat interval). Module-scoped Map so all SSE handlers share state.
const sseConnections = new Map<string, number>();

// Free-tier app: every route in the Free baseline is chained here. Paid
// modules are loaded right before `.listen()` via `loadPaidModules()` so a
// Free build (with an empty registry) is byte-identical to "no Paid wiring".
const baseApp = new Elysia()
  // CORS for cookie auth: explicit origin + credentials (no wildcard).
  .use(cors({ origin: PUBLIC_ORIGIN, credentials: true }))
  .onRequest((ctx) => {
    (ctx as any).startTime = performance.now();
  })
  .onAfterResponse((ctx) => {
    const url = new URL(ctx.request.url);
    const path = url.pathname;

    // Filter out frequent read-only polling requests to keep logs quiet
    if (
      ctx.request.method === "GET" &&
      (path.endsWith("/stats") ||
        path.endsWith("/activity") ||
        path.endsWith("/overview") ||
        path.endsWith("/products") ||
        path.endsWith("/orders") ||
        path.endsWith("/config") ||
        path === "/api/health")
    ) {
      return;
    }

    const duration = (ctx as any).startTime
      ? `${(performance.now() - (ctx as any).startTime).toFixed(1)}ms`
      : "";

    const method = ctx.request.method;
    let methodBg = "\x1b[47m\x1b[30m";
    if (method === "GET") methodBg = "\x1b[42m\x1b[30m";
    else if (method === "POST") methodBg = "\x1b[44m\x1b[97m";
    else if (method === "PUT" || method === "PATCH") methodBg = "\x1b[43m\x1b[30m";
    else if (method === "DELETE") methodBg = "\x1b[41m\x1b[97m";
    const methodBlock = `${methodBg} ${method.padEnd(5)} \x1b[0m`;

    const status = Number(ctx.set.status ?? 200);
    let statusBg = "\x1b[42m\x1b[30m";
    if (status >= 500) statusBg = "\x1b[41m\x1b[97m";
    else if (status >= 400) statusBg = "\x1b[43m\x1b[30m";
    else if (status >= 300) statusBg = "\x1b[46m\x1b[30m";
    const statusBlock = `${statusBg} ${status} \x1b[0m`;

    console.log(
      `${methodBlock} ${url.pathname.padEnd(35)} ${statusBlock} \x1b[90m(${duration})\x1b[0m`,
    );
  })
  .onError(({ code, error, request }) => {
    const url = new URL(request.url);
    // Elysia v1 widens `error` to a Readonly union that includes
    // ElysiaCustomStatusResponse (no .message). Narrow defensively.
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);

    // Classify error severity
    let severity = "HIGH";
    if (
      code === "NOT_FOUND" ||
      code === "VALIDATION" ||
      message.includes("rate limit") ||
      message.includes("unauthorized") ||
      message.includes("forbidden")
    ) {
      severity = "LOW";
    } else if (
      message.includes("third-party") ||
      message.includes("email") ||
      message.includes("blockchain") ||
      message.includes("explorer") ||
      message.includes("BlockCypher")
    ) {
      severity = "MEDIUM";
    }

    console.error(
      `[ERROR] [SEVERITY:${severity}] \x1b[41m\x1b[97m ERR \x1b[0m \x1b[31m${request.method} ${url.pathname} - Code: ${code} | Error: ${message}\x1b[0m`,
    );
  })
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
    set.headers["permissions-policy"] =
      "geolocation=(), microphone=(), camera=(), usb=(), payment=(), midi=()";
    set.headers["cross-origin-resource-policy"] = "same-site";
    set.headers["cross-origin-opener-policy"] = "same-origin";
    set.headers["content-security-policy"] =
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    if (Bun.env.NODE_ENV === "production") {
      set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains; preload";
    }
  })

  .use(healthRoutes)

  // Client error sink. Hardened post-audit:
  //  1) Per-IP rate limit (30/min) so a hostile client can't drown the log
  //     pipeline or waste disk.
  //  2) All user-controlled strings are length-capped and stripped of ASCII
  //     control chars (incl. ANSI escapes) BEFORE concatenation, so a
  //     malicious payload can't hijack the operator's terminal or forge
  //     fake "[SEVERITY:HIGH]" lines next to real alerts.
  //  3) The body's `severity` is logged as advisory only; the line tag is
  //     hard-coded CLIENT_REPORT so server-emitted [ERROR] alerts remain
  //     distinguishable.
  .post(
    "/api/log-error",
    ({ body, request, set }) => {
      const ip = clientIp(request);
      const rl = rateLimitCheck(`log-error:${ip}`, 30, 60_000);
      if (!rl.allowed) {
        set.status = 429;
        set.headers["Retry-After"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Too many requests", code: "RATE_LIMITED" };
      }
      const sanitize = (s: unknown, max: number): string =>
        typeof s === "string" ? s.replace(/[\x00-\x1F\x7F]/g, " ").slice(0, max) : "";
      const msg = sanitize(body.message, 2048) || "(empty)";
      const stack = sanitize(body.stack, 2048);
      const url = sanitize(body.url, 1024);
      const sev = body.severity === "HIGH" || body.severity === "MEDIUM" ? body.severity : "LOW";
      console.error(
        `[CLIENT_REPORT] [advisory:${sev}] [ip:${ip}] ${msg} | url=${url}${stack ? ` | stack=${stack}` : ""}`,
      );
      return { ok: true };
    },
    {
      body: t.Object({
        message: t.String({ maxLength: 4096 }),
        severity: t.Optional(t.Union([t.Literal("LOW"), t.Literal("MEDIUM"), t.Literal("HIGH")])),
        stack: t.Optional(t.String({ maxLength: 4096 })),
        url: t.Optional(t.String({ maxLength: 2048 })),
      }),
    },
  )

  // ───── Real-time Payment Updates (SSE) ─────
  .get(
    "/api/orders/:id/events",
    async ({ params: { id }, query, cookie, set, status, request }) => {
      // Per-key SSE concurrency cap. Without this a single hostile (or buggy)
      // client could open thousands of streams against orders it owns —
      // exhausting file descriptors AND ballooning watcher.deliverHooks[]
      // (each open stream = one DeliverHook subscription) which makes every
      // paid-order delivery iterate at O(N) over a huge list. 5/key is far
      // above legitimate usage (a few open tabs at most).
      const SSE_KEY_CAP = 5;
      // Auth: must be the order owner OR present a valid order token. Without
      // this gate any caller could subscribe to deliveries for any guessable
      // orderId, turning the stream into a delivery side-channel oracle.
      const u = await validateSession(cookie[SESSION_COOKIE]?.value as string | undefined);
      const o = (await db.select().from(orders).where(eq(orders.id, id)))[0];
      const isOwner = !!o && !!u && (o.userId === u.id || u.role === "admin");
      const isTokenValid = verifyOrderToken(id, query?.token);
      if (!o || (!isOwner && !isTokenValid)) {
        return status(404, { error: "Not found", code: "NOT_FOUND" });
      }

      // Concurrency key: prefer userId for authed callers, fall back to
      // IP for token-only guests so one guest browser cannot fan out either.
      const sseKey = u ? `u:${u.id}` : `ip:${clientIp(request)}`;
      const current = sseConnections.get(sseKey) ?? 0;
      if (current >= SSE_KEY_CAP) {
        set.status = 429;
        set.headers["Retry-After"] = "30";
        return { error: "Too many open streams", code: "SSE_LIMIT" };
      }
      sseConnections.set(sseKey, current + 1);

      set.headers["content-type"] = "text/event-stream";
      set.headers["cache-control"] = "no-cache";
      set.headers.connection = "keep-alive";
      set.headers["x-accel-buffering"] = "no"; // disable proxy buffering

      let cleanup: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      // Single source of truth for stream teardown. Called from:
      //   1. cancel() — consumer aborts the ReadableStream
      //   2. send() catch — enqueue threw (client disconnected mid-write)
      //   3. abort listener — request signal fired
      // Idempotent via the `closed` guard so multiple triggers only release
      // the slot once. Previously the send() catch flipped `closed=true` but
      // did NOT release the deliverHook subscription or clear the heartbeat
      // interval — when cancel() failed to fire afterwards (e.g. abort raced
      // the enqueue), both leaked until process exit. Over a busy storefront
      // that pushes deliverHooks toward DELIVER_HOOKS_MAX and stalls payment
      // delivery.
      const teardown = () => {
        if (closed) return;
        closed = true;
        if (cleanup) cleanup();
        if (heartbeat) clearInterval(heartbeat);
        cleanup = null;
        heartbeat = null;
        const c = sseConnections.get(sseKey) ?? 0;
        if (c <= 1) sseConnections.delete(sseKey);
        else sseConnections.set(sseKey, c - 1);
      };

      // Lifecycle: subscriber appends to deliverHooks[] + arms heartbeat.
      // Tear both down on client disconnect or the list grows unbounded and
      // controller.enque() against a closed stream throws.
      return new ReadableStream({
        start(controller) {
          const send = (data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(`data: ${JSON.stringify(data)}

`);
            } catch {
              // Enqueue against a closed/aborted stream: tear down NOW.
              // cancel() is not guaranteed to fire (the runtime may have
              // already discarded the stream), so this is the cleanup site.
              teardown();
              try {
                controller.close();
              } catch {}
            }
          };

          send({ type: "connected", orderId: id });

          cleanup = onOrderDelivered((deliveredId) => {
            if (deliveredId === id) send({ type: "status_update", status: "paid" });
          });
          heartbeat = setInterval(() => send({ type: "heartbeat" }), 30_000);

          request.signal?.addEventListener("abort", () => {
            teardown();
            try {
              controller.close();
            } catch {}
          });
        },
        cancel() {
          teardown();
        },
      });
    },
    {
      query: t.Object({
        token: t.Optional(t.String()),
      }),
    },
  )

  // ───── Public routes (no auth required) ─────
  .use(configRoutes);

// Integrity verifier — reads manifest.signed.json, hashes every listed
// file, returns OK / degraded / skipped (dev mode). MUST run before
// loadPlugins() so the loader can refuse paid plugins on a tampered
// build instead of registering routes against a hashed-mismatch binary.
// In dev without a manifest the verifier reports `manifest_not_found`
// and the policy in lib/integrity-state.ts tolerates that — `bun dev`
// stays frictionless. In prod, missing/invalid manifest → degraded mode,
// paid plugins skipped, banner red, admin mutations gated.
const integrityResult = await initIntegrity();

// Paid modules register BEFORE productRoutes so static paths like
// /api/products/suggest are not shadowed by the dynamic /api/products/:idOrSlug
// route. Loader is licence-gated AND integrity-gated; on a degraded build
// every paid plugin is skipped with reason "integrity degraded".
const app = (await loadPlugins(baseApp))
  .use(productRoutes)
  .use(categoryRoutes)

  // ───── Auth + customer routes ─────
  .use(authRoutes)
  .use(customer2faRoutes)
  .use(reviewRoutes)
  .use(ticketRoutes)

  // ───── Admin routes ────
  .use(adminRoutes)
  .use(admin2faRoutes)
  .use(adminBlocklistRoutes)
  .use(adminTicketRoutes)
  .use(adminDbRoutes)
  .use(adminTablesRoutes)
  .use(adminUpdateRoutes)

  // ─── Checkout + setup ─────
  .use(checkoutRoutes)
  .use(setupRoutes)

  // ───── Dev routes (SSE log stream, health) — only in non-production ─────
  .use(Bun.env.NODE_ENV === "production" ? new Elysia() : devRoutes);

// Bootstrap admin + prime crypto secrets BEFORE anything else can observe
// the throw-on-uninitialized branch in generateOrderToken. Previously this
// ran post-listen and there was a sliver of a window where /api/checkout
// could 500 instead of returning a token.
await bootstrapAdmin();
await primeOrderTokenSecret();

// Register delivery hooks BEFORE recoverStuckOrders / startWatcher / listen.
// Previously the email hook was registered AFTER recoverStuckOrders(), so a
// crash-recovery delivery on boot could complete with no email side-effect.
onOrderDelivered((orderId, email, keys) => {
  EmailService.deliveredKeys(orderId, email, keys).then((r) => {
    if ("error" in r) console.warn(`[email] order ${orderId} send failed: ${r.error}`);
    else if ("id" in r) console.log(`[email] delivered-keys sent for ${orderId} (${r.id})`);
  });
});

// Invalidate the public catalog cache the moment stock moves. Without this,
// a freshly out-of-stock SKU keeps showing as available for up to TTL seconds
// after delivery — annoying for high-velocity inventory and an actual bug for
// low-stock single-key SKUs where two customers see "1 in stock" simultaneously.
onOrderDelivered(() => {
  clearCatalogCache();
});

// Recover any orders that were mid-flight when the previous process died,
// then start the watcher loop. Both run BEFORE listen() so the first inbound
// request sees a fully consistent world: no half-delivered orders, no
// "address index already used" race against a stuck pending order.
await recoverStuckOrders();
// Register built-in notification dispatchers (Discord/Telegram/webhook)
import { registerNotifications } from "./lib/notifications.ts";
registerNotifications();
startWatcher();

app.listen(Number(Bun.env.PORT ?? 3000));

printBootBanner({
  license: (globalThis as any).__nexora_license ?? null,
  integrity: toBannerInfo(integrityResult),
  plugins: (globalThis as any).__nexora_plugins ?? [],
  adminEmail: (globalThis as any).__nexora_admin_email ?? null,
});

export type App = typeof app;
