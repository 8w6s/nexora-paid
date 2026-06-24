// Central API client. Base URL comes from env (NO hardcoded localhost:3000).
// PUBLIC_* vars are exposed to the client bundle by Astro/Vite.
//
// Resolution order:
//   1. PUBLIC_API_ORIGIN env var (explicit absolute URL — used in dev when
//      backend runs on a different port than the Astro dev server).
//   2. Empty string → same-origin relative requests (production behind Caddy:
//      /api/* is proxied to the backend on the same host as the page).
//   3. http://localhost:3000 fallback only on the server during SSR with no
//      env set (so `bun run dev` keeps working without configuration).
const rawOrigin = import.meta.env.PUBLIC_API_ORIGIN as string | undefined;
const isProd = import.meta.env.PROD === true;

// SSR fallback to localhost:3000 is for `bun run dev` ergonomics ONLY. In a
// production container the backend is not on localhost — it's reachable via
// the docker service name (e.g. http://backend:3000) or same-origin behind
// Caddy. Warn loudly so a missed env doesn't silently 502 every SSR page.
const ssrFallback = (() => {
  if (rawOrigin !== undefined && rawOrigin !== "") return rawOrigin;
  if (isProd) {
    if (typeof window === "undefined") {
      console.warn(
        "[api] PUBLIC_API_ORIGIN is not set in production. SSR will fall back to http://localhost:3000 which usually fails in a container — set PUBLIC_API_ORIGIN to http://backend:3000 (compose service) or your public origin.",
      );
    }
    return typeof window === "undefined" ? "http://localhost:3000" : "";
  }
  return typeof window === "undefined" ? "http://localhost:3000" : "";
})();

export const API_ORIGIN = ssrFallback;

export type ApiError = { error: string; code: string };

// Best-effort error reporter. Uses sendBeacon when available so payloads survive
// page unload AND kep the page eligible for the back-forward cache (a regular
// keepalive fetch on `pagehide` makes Chrome evict the page from bfcache).
// Falls back to fetch+keepalive for browsers without sendBeacon.
export const reportClientError = (
  message: string,
  severity: "LOW" | "MEDIUM" | "HIGH" = "LOW",
  stack?: string,
): void => {
  try {
    const payload = JSON.stringify({
      message,
      severity,
      stack,
      url: typeof window !== "undefined" ? window.location.href : "SSR",
    });
    const url = `${API_ORIGIN}/api/log-error`;
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      // sendBeacon is same-origin-friendly; only use it when we don't need an
      // explicit Origin (i.e. relative API_ORIGIN). Cross-origin reporting falls
      // through to fetch.
      (API_ORIGIN === "" ||
        (typeof window !== "undefined" && url.startsWith(window.location.origin)))
    ) {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Reporting must never throw or surface its own failures.
    });
  } catch {
    // ignore — reporting is best-effort.
  }
};

// 30-second client-side dedup so a flapping endpoint doesn't spam the log
// pipeline. Keyed by `${status}:${method}:${path}` (or "net:..." for network
// failures). Stale entries are GC'd when the map grows past 100 keys.
const _DEDUP_WINDOW_MS = 30_000;
const _dedupMap = new Map<string, number>();
const _shouldReport = (key: string): boolean => {
  const now = Date.now();
  const last = _dedupMap.get(key);
  if (last !== undefined && now - last < _DEDUP_WINDOW_MS) return false;
  _dedupMap.set(key, now);
  if (_dedupMap.size > 100) {
    for (const [k, ts] of _dedupMap) {
      if (now - ts >= _DEDUP_WINDOW_MS) _dedupMap.delete(k);
    }
  }
  return true;
};

// Idempotent global error listeners. HMR / re-imports must not stack duplicate
// handlers (each duplicate would re-fire reportClientError for the same event).
if (typeof window !== "undefined") {
  const w = window as unknown as { __nexora_err_bound?: boolean };
  if (!w.__nexora_err_bound) {
    w.__nexora_err_bound = true;
    window.addEventListener("error", (event) => {
      if (event.filename && event.filename.includes("/api/log-error")) return;
      const key = `error:${event.filename ?? ""}:${event.lineno ?? 0}:${event.message}`;
      if (!_shouldReport(key)) return;
      reportClientError(event.message, "LOW", event.error?.stack);
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      const key = `rejection:${msg}`;
      if (!_shouldReport(key)) return;
      reportClientError(`Unhandled Promise Rejection: ${msg}`, "LOW", stack);
    });
  }
}

// Allow callers to forward an AbortSignal so they can cancel inflight requests
// on unmount (Checkout polling, AdminProductEditor parallel loads, etc.).
type RequestOpts = RequestInit & { signal?: AbortSignal };

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      credentials: "include", // send/receive the session cookie
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
  } catch (err) {
    // Aborts are intentional — never report them.
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    if (!isAbort) {
      // Network-level failures (offline, DNS, refused) carry no status code, so
      // they always merit a report (subject to dedup).
      const msg = err instanceof Error ? err.message : String(err);
      const method = (opts.method ?? "GET").toUpperCase();
      if (_shouldReport(`net:${method}:${path}:${msg}`)) {
        reportClientError(
          `${method} ${path} -> network error: ${msg}`,
          "MEDIUM",
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as ApiError;
    const reqErr = new ApiRequestError(
      err.error || `Request failed (${res.status})`,
      err.code || "ERROR",
      res.status,
    );
    // Only auto-report 5xx (server-side problems). 4xx (auth, validation,
    // not-found, rate-limit) are expected outcomes of normal user flow and
    // would otherwise drown the error log in noise.
    if (res.status >= 500) {
      const method = (opts.method ?? "GET").toUpperCase();
      if (_shouldReport(`${res.status}:${method}:${path}`)) {
        reportClientError(reqErr.message, "HIGH", reqErr.stack);
      }
    }
    throw reqErr;
  }
  return data as T;
}

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Centralized 404 routing: any backend response that means "you cannot see this
 * resource" (NOT_FOUND or UNAUTHENTICATED) should land on the standalone /404
 * page. Unified so an attacker cannot tell "doesn't exist" from "someone else's".
 */
export const isNotFound = (e: unknown): boolean =>
  e instanceof ApiRequestError && (e.status === 404 || e.code === "NOT_FOUND");

export const isAccessDenied = (e: unknown): boolean =>
  isNotFound(e) ||
  (e instanceof ApiRequestError && (e.status === 401 || e.code === "UNAUTHENTICATED"));

export const goTo404 = (): void => {
  if (typeof window !== "undefined") window.location.replace("/404");
};

// Signal-only opts the call sites need; full RequestInit stays internal.
type CallOpts = { signal?: AbortSignal };

export const api = {
  get: <T>(path: string, opts: CallOpts = {}) => request<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts: CallOpts = {}) =>
    request<T>(path, {
      ...opts,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown, opts: CallOpts = {}) =>
    request<T>(path, {
      ...opts,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown, opts: CallOpts = {}) =>
    request<T>(path, {
      ...opts,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  del: <T>(path: string, opts: CallOpts = {}) => request<T>(path, { ...opts, method: "DELETE" }),
  delete: <T>(path: string, opts: CallOpts = {}) => request<T>(path, { ...opts, method: "DELETE" }),
};

/* Types shared across the frontend */
export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceUsd: number;
  compareAtPrice?: number | null;
  image: string;
  category: string;
  stock: number;
  inStock: boolean;
  sold: number;
  variants?: {
    id: string;
    name: string;
    priceUsd: number;
    compareAtPrice: number | null;
    stock: number;
    inStock: boolean;
  }[];
}

export interface OrderSummary {
  id: string;
  status: string;
  totalUsd: number;
  ltcAmount: string;
  createdAt: number;
  items: { name: string; quantity: number; priceUsd: number }[];
}

export interface OrderDetail extends OrderSummary {
  expectedLitoshi: number;
  ltcAddress: string;
  qrCodeUrl: string;
  confirmations: number;
  rateExpiresAt: number;
  deliveredKeys: { code: string; productId: string }[];
}

export interface CheckoutResult {
  orderId: string;
  status: string;
  totalUsd: number;
  usdLtcRate: number;
  ltcAmount: string;
  expectedLitoshi: number;
  ltcAddress: string;
  qrCodeUrl: string;
  rateExpiresAt: number;
}

export interface OrderStatus {
  status: string;
  confirmations: number;
  requiredConfirmations: number;
  receivedLitoshi: number;
  expectedLitoshi: number;
  expiresInSec: number;
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
