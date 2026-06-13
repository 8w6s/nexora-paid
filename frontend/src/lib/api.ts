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
export const API_ORIGIN =
  rawOrigin !== undefined && rawOrigin !== ""
    ? rawOrigin
    : typeof window === "undefined"
      ? "http://localhost:3000"
      : "";

export type ApiError = { error: string; code: string };

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    credentials: "include", // send/receive the session cookie
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as ApiError;
    throw new ApiRequestError(
      err.error || `Request failed (${res.status})`,
      err.code || "ERROR",
      res.status,
    );
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
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
