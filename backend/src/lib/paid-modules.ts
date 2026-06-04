/**
 * Paid module plugin API.
 *
 * A "paid module" is a self-contained feature that ships with the Paid tier
 * but not Free: search-with-autocomplete, multi-crypto, affiliate program,
 * Discord/Telegram bot, etc. Each module exposes an Elysia plugin which is
 * applied to the root app at boot — but only after `verifyLicense()` returns
 * a valid signature. Free builds ship with an empty registry so this loader
 * is a no-op there; Paid builds populate the registry from
 * `backend/src/paid/index.ts`.
 *
 * Why this shape:
 *  - Elysia's `.use(plugin)` is chainable but cannot be applied after
 *    `.listen()`, so the loader returns the new (typed) app instance and the
 *    caller MUST reassign before listening.
 *  - We never throw on license failure — we log + return the app unchanged so
 *    a tampered/missing license downgrades to Free behavior gracefully
 *    instead of crashing the whole shop.
 */
import type { Elysia } from "elysia";

export interface PaidModule {
  /** Stable id, used in logs + future per-module enable flags */
  id: string;
  /** Human description shown on boot */
  description: string;
  /**
   * Attach this module's routes/hooks to the app. Receives the current app
   * and MUST return the new app (Elysia chainable). Async allowed for
   * modules that need to load secrets/keys from settings before registering.
   */
  register: (app: Elysia<any, any, any, any, any, any, any, any>) => Elysia<any, any, any, any, any, any, any, any> | Promise<Elysia<any, any, any, any, any, any, any, any>>;
}

/**
 * Load and register all paid modules from the in-tree registry.
 * Returns the (possibly mutated) app for chaining into `.listen()`.
 *
 * Behavior:
 *  - Registry empty (Free build, or Paid with no modules wired yet) → no-op.
 *  - License missing/invalid → log + skip registration (Free behavior).
 *  - Registry present + license valid → register each module in order.
 *  - A module's `register` throwing is caught + logged; other modules still
 *    load. We never let a single broken Paid module take down the API.
 */
export async function loadPaidModules<A extends Elysia<any, any, any, any, any, any, any, any>>(app: A): Promise<A> {
  let modules: PaidModule[] = [];
  try {
    // Dynamic import so a Free build that deletes /paid/ entirely still boots.
    const reg = await import("../paid/index.ts").catch(() => ({ paidModules: [] as PaidModule[] }));
    modules = reg.paidModules ?? [];
  } catch (e) {
    console.warn(`[paid] registry import failed: ${e instanceof Error ? e.message : e}`);
    return app;
  }
  if (modules.length === 0) {
    // Registry is empty (Free build OR Paid that hasn't wired any modules
    // yet). In dev we still surface the license state so the maintainer
    // can confirm verification works before adding the first module.
    if (Bun.env.NODE_ENV !== "production") {
      try {
        const { verifyLicense } = await import("./license.ts");
        const r = await verifyLicense();
        if (r.valid) console.log(`[paid] license valid (${r.email}); registry empty — no modules to load.`);
        else console.log(`[paid] registry empty; license check: ${r.reason}`);
      } catch { /* ignore — verifying empty registry is best-effort only */ }
    }
    return app;
  }

  // License gate. verifyLicense() is intentionally lazy-imported so Free
  // builds that don't ship the license module still link cleanly.
  let licenseOk = false;
  let licenseEmail: string | null = null;
  try {
    const { verifyLicense } = await import("./license.ts");
    const result = await verifyLicense();
    licenseOk = result.valid;
    licenseEmail = result.valid ? result.email : null;
    if (!licenseOk) console.warn(`[paid] license invalid (${result.reason}) — paid modules disabled.`);
  } catch (e) {
    console.warn(`[paid] license check failed: ${e instanceof Error ? e.message : e} — paid modules disabled.`);
  }
  if (!licenseOk) return app;

  console.log(`[paid] license valid (${licenseEmail}); loading ${modules.length} module(s)…`);
  let current: any = app;
  for (const mod of modules) {
    try {
      current = await mod.register(current);
      console.log(`[paid]   ✓ ${mod.id} — ${mod.description}`);
    } catch (e) {
      console.error(`[paid]   ✗ ${mod.id} failed to register: ${e instanceof Error ? e.message : e}`);
    }
  }
  return current as A;
}
