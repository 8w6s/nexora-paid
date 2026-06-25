// backend/src/lib/plugin/types.ts
import type { Elysia } from "elysia";

/**
 * Manifest fields a plugin MUST declare. The loader rejects (logs + skips)
 * any plugin missing required fields or failing the semver pin against
 * NEXORA_VERSION. id MUST be a stable lower-kebab-case string.
 */
export interface PluginManifest {
  /** Stable lower-kebab id, e.g. "search-suggest", "discord-role-sync". */
  id: string;
  /** Plugin's own semver, e.g. "1.0.0" — surfaced in logs + admin UI. */
  version: string;
  /** Semver range against NEXORA_VERSION, e.g. ">=0.2 <0.3". */
  nexoraVersion: string;
  /** Human description shown on boot + admin UI. */
  description: string;
}

/**
 * Lifecycle hooks emitted by core. Plugins subscribe via `hooks` in the
 * Plugin object. Payloads are exact, not `any` — add new hooks here when
 * core emits them.
 */
export interface HookPayloads {
  "order.created": { orderId: string; userId: string };
  "payment.paid": { orderId: string; userId: string; amountUsd: number };
  "product.delivered": {
    orderId: string;
    userId: string;
    productId: string;
    deliveredKeys: string[];
  };
  "user.created": { userId: string; email: string };
}

export type HookName = keyof HookPayloads;

/**
 * Plugin object. `register()` is the Elysia route attach (kept from v1
 * PaidModule). `hooks` is the new subscription map; each handler is awaited
 * sequentially in registration order. `migrations` (optional) returns SQL
 * statements (one per migration), run idempotently against the connection
 * before `register()`.
 */
export interface Plugin {
  manifest: PluginManifest;
  register?: (
    app: Elysia<any, any, any, any, any, any, any>,
  ) =>
    | Elysia<any, any, any, any, any, any, any>
    | Promise<Elysia<any, any, any, any, any, any, any>>;
  hooks?: Partial<{ [K in HookName]: (payload: HookPayloads[K]) => Promise<void> | void }>;
  /**
   * Plugin-owned SQL migrations. Each entry is an idempotent `CREATE TABLE
   * IF NOT EXISTS ...` (or equivalent) and is tracked in the
   * `__plugin_migrations` table by (pluginId, index). Migrations only ever
   * append — never edit a past entry.
   */
  migrations?: () => string[];
}
