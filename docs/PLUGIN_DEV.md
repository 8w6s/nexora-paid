# Plugin Development Guide

How to build plugins for Nexora Paid using the Plugin v2 contract.

## Plugin Contract (v2)

### Manifest

Every plugin must declare a manifest:

```typescript
interface PluginManifest {
  id: string;              // lowercase kebab-case, stable, e.g. "search-suggest"
  version: string;         // semver, e.g. "1.0.0"
  nexoraVersion: string;   // semver range, e.g. ">=0.2 <0.3"
  description: string;     // human-readable, shown in admin UI + boot logs
}
```

**Rules**:
- `id`: must be unique, unchanged after release (used for migrations + feature flag)
- `version`: bump on plugin updates
- `nexoraVersion`: pin to compatible Nexora core versions (semver.satisfies)
  - Example: if Nexora v0.2 breaks plugin API, use `">=0.2 <0.3"`
  - If Nexora bumps to 0.3, plugins must update their range
- `description`: max 100 chars

### Plugin Object

```typescript
interface Plugin {
  manifest: PluginManifest;
  register?: (app: Elysia) => Elysia | Promise<Elysia>;
  hooks?: Partial<{ ... }>;
  migrations?: () => string[];
}
```

## Lifecycle

### 1. License Gate

Before ANY plugin loads, license must verify. If invalid:
- All plugins are skipped
- App falls back to Free behavior
- Log: `[plugin] license invalid (reason); skipping all N plugin(s)`

### 2. Per-Plugin Compat Check

```typescript
const compat = checkCompat(NEXORA_VERSION, manifest.nexoraVersion);
if (!compat.ok) {
  console.warn(`[plugin] ${id} skipped — ${compat.reason}`);
  // skip register + hooks + migrations
}
```

**Example**:
- Nexora v0.2.0, plugin requires ">=0.2 <0.3" → OK
- Nexora v0.3.0, plugin requires ">=0.2 <0.3" → SKIP (incompatible)

### 3. Per-Plugin Enabled Flag

Admin can disable plugin via Settings:
```typescript
const flag = settings[`feature_plugin_${id}`];
if (flag === "false") {
  console.log(`[plugin] ${id} skipped — disabled by admin`);
  // skip migrations + register + hooks
}
```

### 4. Run Migrations

```typescript
if (plugin.migrations) {
  const r = await runPluginMigrations(db, id, plugin.migrations());
  if (r.error) {
    console.error(`[plugin] ${id} migration failed: ${r.error}`);
    // skip register (but don't throw — app continues)
  }
}
```

**Idempotency**: migrations tracked in `__plugin_migrations` table (pluginId, index, appliedAt). Each migration only runs once.

### 5. register() Routes

```typescript
if (plugin.register) {
  try {
    app = await plugin.register(app);
  } catch (e) {
    console.error(`[plugin] ${id} register threw: ${e.message}`);
    // skip hooks (but don't crash core)
  }
}
```

Route failures don't crash server; logged and hooks skipped.

### 6. Hook Subscribe

```typescript
if (plugin.hooks) {
  for (const [hookName, handler] of Object.entries(plugin.hooks)) {
    hookBus.subscribe(id, hookName, handler);
  }
}
```

Hook handlers executed sequentially in registration order. Error in one handler doesn't prevent others (error-isolated).

## Available Hooks

### order.created

**Triggered**: new order created after checkout

```typescript
hook: async (payload: { orderId: string; userId: string }) => {
  console.log(`Order created: ${payload.orderId}`);
}
```

**Use**: trigger external notification, log to analytics, etc.

### payment.paid

**Triggered**: watcher confirms order is paid (≥ amount, ≥ confirmations)

```typescript
hook: async (payload: {
  orderId: string;
  userId: string;
  amountUsd: number;
}) => {
  console.log(`${payload.amountUsd} USD paid for order ${payload.orderId}`);
}
```

**Use**: webhook to external system, analytics, etc.

### product.delivered

**Triggered**: order keys delivered (email sent if enabled, or marked delivered)

```typescript
hook: async (payload: {
  orderId: string;
  userId: string;
  productId: string;
  deliveredKeys: string[];  // array of key codes
}) => {
  console.log(`Delivered ${payload.deliveredKeys.length} keys to user ${payload.userId}`);
}
```

**Use**: log fulfillment, update inventory system, send receipt, etc.

### user.created

**Triggered**: new customer account created (register)

```typescript
hook: async (payload: { userId: string; email: string }) => {
  console.log(`New user: ${payload.email}`);
}
```

**Use**: welcome email, onboarding flow, CRM sync, etc.

## Idempotency Rules

### Migrations Must Be Idempotent

```typescript
migrations(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS my_plugin_data (
       id TEXT PRIMARY KEY,
       created_at INTEGER
     )`,
    // NOT: `CREATE TABLE my_plugin_data (...)` — will fail if table exists
  ];
}
```

**Why**: if server crashes during migration, watcher retries. Must not error twice.

### Handlers Should Be Idempotent

```typescript
hooks: {
  "payment.paid": async (payload) => {
    // ❌ BAD: always insert, will duplicate if called twice
    await db.insert(analytics).values({ orderId: payload.orderId, ... });

    // ✅ GOOD: upsert or check first
    const existing = await db.query.analytics.findFirst({
      where: (t, { eq }) => eq(t.orderId, payload.orderId),
    });
    if (!existing) {
      await db.insert(analytics).values({ orderId: payload.orderId, ... });
    }
  },
}
```

**Why**: hooks can fire multiple times (hook bus rerun, server restart, admin mark-paid). Must be safe to call N times.

## Code Example: Minimal Plugin

```typescript
// my-plugin.ts
import type { Plugin } from "../lib/plugin/types.ts";

export const myPlugin: Plugin = {
  manifest: {
    id: "my-plugin",
    version: "1.0.0",
    nexoraVersion: ">=0.2 <0.3",
    description: "Example plugin",
  },

  register: (app) => {
    return app
      .post("/api/my-plugin/webhook", async ({ body }) => {
        console.log("webhook received", body);
        return { ok: true };
      });
  },

  hooks: {
    "payment.paid": async (payload) => {
      console.log(`Payment: ${payload.amountUsd} USD for order ${payload.orderId}`);
      // Send webhook, log to external system, etc.
    },
  },

  migrations: () => [
    `CREATE TABLE IF NOT EXISTS my_plugin_events (
       id TEXT PRIMARY KEY,
       event_type TEXT NOT NULL,
       order_id TEXT,
       created_at INTEGER DEFAULT (unixepoch() * 1000)
     )`,
  ],
};
```

## Testing Plugins

### Local Setup

1. Clone Nexora
2. Create `backend/src/paid/my-plugin.ts`
3. Export from `backend/src/paid/index.ts`:
   ```typescript
   import { myPlugin } from "./my-plugin.ts";
   export const paidModules: Plugin[] = [
     // ... existing
     myPlugin,
   ];
   ```
4. Verify license file exists (or tests will skip plugins)
5. `bun run dev`

### Unit Test Pattern

```typescript
// my-plugin.test.ts
import { describe, it, expect } from "bun:test";
import { myPlugin } from "./my-plugin.ts";

describe("myPlugin", () => {
  it("has valid manifest", () => {
    expect(myPlugin.manifest.id).toBe("my-plugin");
    expect(myPlugin.manifest.nexoraVersion).toMatch(/>=/);
  });

  it("migrations are idempotent", () => {
    const migs = myPlugin.migrations?.();
    expect(migs).toBeDefined();
    migs?.forEach((sql) => {
      expect(sql).toContain("IF NOT EXISTS");
    });
  });

  it("hooks are async", async () => {
    if (!myPlugin.hooks?."payment.paid") throw new Error();
    await expect(
      myPlugin.hooks["payment.paid"]({
        orderId: "test",
        userId: "user1",
        amountUsd: 100,
      })
    ).resolves.toBeUndefined();
  });
});
```

Run: `bun backend/src/paid/my-plugin.test.ts`

## Versioning & Compat

### When to Bump nexoraVersion

**Semver ranges** like `">=0.2 <0.3"`:
- Minor changes (new hooks, new settings): stay in range
- Breaking changes (old hook removed, API changes): bump range

**Example**:
- Nexora v0.2.0: plugins use `">=0.2 <0.3"`
- Nexora v0.3.0 (breaking): all plugins must update to `">=0.3 <0.4"`

### Version Pinning Strategy

- **Loose**: `">=0.2"` (will auto-load on any future Nexora version)
  - ⚠️ Risk: new Nexora version breaks your plugin silently
- **Tight**: `">=0.2 <0.3"` (only 0.2.x)
  - ✅ Recommended: explicit bounds, fails loudly if incompatible
- **Exact**: `"0.2.5"` (only this version)
  - ⚠️ Too restrictive; customers can't upgrade Nexora

## Debugging

### Boot Logs

Plugin loader logs on boot:
```
[plugin] ✓ search-suggest@1.0.0 — Storefront search autocomplete
[plugin] license valid (user@example.com); evaluating 4 plugin(s)…
[plugin] admin-bulk@1.0.0 skipped — disabled by admin
[plugin] my-plugin@1.0.0 register threw: TypeError — skipping hooks
```

### Enable Plugin Per-Admin

Admin → Settings → Features tab → "my-plugin" toggle

### Check Plugin State

Global `globalThis.__nexora_plugins` (populated by loader):
```typescript
const plugins = (globalThis as any).__nexora_plugins;
console.log(plugins);
// [
//   { id: "search-suggest", version: "1.0.0", loaded: true },
//   { id: "my-plugin", version: "1.0.0", loaded: false, reason: "register threw" },
// ]
```

---

**See also**:
- CLUSTERS.md: how plugins fit into roadmap
- LICENSE_ROTATION.md: licensing strategy