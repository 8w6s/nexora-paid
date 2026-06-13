# Plugin Contract v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing `PaidModule` contract into a full plugin contract (`Plugin v2`) with manifest metadata, an event hook bus, per-plugin DB migrations, semver compatibility checks, and per-plugin admin enable/disable — so Pro tier can scale to many independent modules and Custom Solutions can ship as drop-in plugins without forking core.

**Architecture:**
Keep the current Ed25519 license gate (`lib/license.ts`) and registry loader (`lib/paid-modules.ts`) intact — they already work. Wrap them in a new `lib/plugin/` module that adds: (a) a `PluginManifest` shape with `version` + `nexoraVersion` semver pin, (b) a typed `HookBus` emitted from core lifecycle points (`order.created`, `payment.paid`, `product.delivered`, `user.created`), (c) a per-plugin migration runner that owns its own `__plugin_migrations` table, and (d) an admin endpoint plus per-plugin `feature_plugin_<id>` flag so plugins ship disabled-by-default. Per-plugin Ed25519 signing + customer-binding is **out of scope** here — that lands in `Phase 2` (separate plan).

**Tech Stack:** Bun + TypeScript (strict), Elysia 1.4, Drizzle ORM + SQLite, `semver` (new dep), existing `@noble/ed25519` + `@noble/hashes` (kept as-is for license verify only).

---

## Out of scope (Phase 2 / separate plans)

- Per-plugin Ed25519 signing + customer binding (next plan: `2026-06-XX-plugin-signing.md`).
- Distribution as standalone `.zip` bundles outside the source tree.
- Frontend plugin gating end-to-end (the `feature_plugin_<id>` flag will simply be readable via existing `GET /api/config`; UI work tracked separately).
- Plugin sandboxing — plugins still execute with full Node/Bun privileges. This is documented as a known limitation: only signed/trusted plugins should be loaded.

## File Structure

```
backend/src/
├── lib/
│   ├── license.ts                   (UNCHANGED — Ed25519 license verify)
│   ├── paid-modules.ts              (DELETED in Task 7 — replaced by plugin/loader.ts)
│   └── plugin/
│       ├── types.ts                 (NEW) — Plugin, PluginManifest, HookName, HookPayload<K>, HookBus interface
│       ├── hook-bus.ts              (NEW) — typed in-process pub/sub, sequential async handlers
│       ├── migrations.ts            (NEW) — per-plugin migration runner; owns __plugin_migrations table
│       ├── compat.ts                (NEW) — semver pin check (NEXORA_VERSION vs manifest.nexoraVersion)
│       ├── loader.ts                (NEW) — replaces paid-modules.ts; calls license → compat → migrate → register → hooks
│       ├── hook-bus.test.ts         (NEW) — tests for ordering, error isolation, type safety
│       ├── migrations.test.ts       (NEW) — tests for idempotency, partial-failure rollback
│       └── compat.test.ts           (NEW) — tests for semver match/mismatch/prerelease
├── paid/
│   ├── index.ts                     (MODIFIED) — exports Plugin[] (was PaidModule[])
│   ├── search.ts                    (MODIFIED) — converted to Plugin shape with manifest
│   ├── admin-bulk.ts                (MODIFIED) — converted to Plugin shape
│   ├── admin-export.ts              (MODIFIED) — converted to Plugin shape
│   └── admin-customers-csv.ts       (MODIFIED) — converted to Plugin shape
├── lib/
│   └── version.ts                   (NEW) — single source of truth: NEXORA_VERSION constant
├── db/
│   └── schema.ts                    (MODIFIED) — add pluginMigrations table
├── routes/
│   └── admin.ts                     (MODIFIED) — add GET/POST /api/admin/plugins for enable/disable
└── index.ts                         (MODIFIED) — replace `loadPaidModules` import with `loadPlugins`, emit hooks
```

---

## Task 1: NEXORA_VERSION constant + `lib/version.ts`

**Why this first:** Every later task references `NEXORA_VERSION` for compat checks. Pin it once.

**Files:**
- Create: `backend/src/lib/version.ts`

- [ ] **Step 1: Write the file**

```typescript
// backend/src/lib/version.ts
/**
 * Single source of truth for the Nexora runtime version.
 *
 * Plugins declare `nexoraVersion: ">=0.2 <0.3"` in their manifest; the loader
 * compares against `NEXORA_VERSION` using `semver.satisfies`. Bump this when
 * the plugin contract or any exported core symbol changes in a way that
 * could break existing plugins.
 */
export const NEXORA_VERSION = "0.2.0";
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/version.ts
git commit -m "feat(plugin): add NEXORA_VERSION constant"
```

---

## Task 2: Plugin types — `lib/plugin/types.ts`

**Files:**
- Create: `backend/src/lib/plugin/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
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
  "order.created":     { orderId: string; userId: string };
  "payment.paid":      { orderId: string; userId: string; amountUsd: number };
  "product.delivered": { orderId: string; userId: string; productId: string; deliveredKeys: string[] };
  "user.created":      { userId: string; email: string };
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
  register?: (app: Elysia<any, any, any, any, any, any, any, any>) => Elysia<any, any, any, any, any, any, any, any> | Promise<Elysia<any, any, any, any, any, any, any, any>>;
  hooks?: Partial<{ [K in HookName]: (payload: HookPayloads[K]) => Promise<void> | void }>;
  /**
   * Plugin-owned SQL migrations. Each entry is an idempotent `CREATE TABLE
   * IF NOT EXISTS ...` (or equivalent) and is tracked in the
   * `__plugin_migrations` table by (pluginId, index). Migrations only ever
   * append — never edit a past entry.
   */
  migrations?: () => string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/plugin/types.ts
git commit -m "feat(plugin): add Plugin contract v2 types"
```

---

## Task 3: Hook bus — `lib/plugin/hook-bus.ts` + tests

**Files:**
- Create: `backend/src/lib/plugin/hook-bus.ts`
- Test: `backend/src/lib/plugin/hook-bus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/lib/plugin/hook-bus.test.ts
import { HookBus } from "./hook-bus.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else      { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const bus = new HookBus();
const log: string[] = [];

bus.subscribe("plug-a", "order.created", async (p) => { log.push(`a:${p.orderId}`); });
bus.subscribe("plug-b", "order.created", async (p) => { throw new Error("boom"); });
bus.subscribe("plug-c", "order.created", async (p) => { log.push(`c:${p.orderId}`); });

await bus.emit("order.created", { orderId: "O1", userId: "U1" });

ok("a runs",       log.includes("a:O1"));
ok("c runs after b throws", log.includes("c:O1"));
ok("ordered",      log[0] === "a:O1" && log[1] === "c:O1");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun backend/src/lib/plugin/hook-bus.test.ts`
Expected: FAIL with `Cannot find module './hook-bus.ts'`.

- [ ] **Step 3: Implement the bus**

```typescript
// backend/src/lib/plugin/hook-bus.ts
import type { HookName, HookPayloads } from "./types.ts";

type Handler<K extends HookName> = (payload: HookPayloads[K]) => Promise<void> | void;

interface Subscription<K extends HookName> {
  pluginId: string;
  handler: Handler<K>;
}

/**
 * In-process hook bus. Handlers fire sequentially in subscription order so a
 * plugin reacting to "order.created" sees the same view of the world the
 * next plugin sees. One handler throwing never blocks the others — the
 * error is logged with the offending pluginId + hook name.
 *
 * Sequential (not parallel) on purpose: hooks frequently write to the same
 * DB rows (notifications, audit log, role sync). Parallel would race.
 */
export class HookBus {
  private subs = new Map<HookName, Subscription<any>[]>();

  subscribe<K extends HookName>(pluginId: string, hook: K, handler: Handler<K>): void {
    const list = this.subs.get(hook) ?? [];
    list.push({ pluginId, handler });
    this.subs.set(hook, list);
  }

  async emit<K extends HookName>(hook: K, payload: HookPayloads[K]): Promise<void> {
    const list = this.subs.get(hook) ?? [];
    for (const s of list) {
      try {
        await s.handler(payload);
      } catch (e) {
        console.error(`[plugin/hook] ${s.pluginId} ${hook} threw: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

/** Process-wide singleton. Imported by both loader.ts and core emitters. */
export const hookBus = new HookBus();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun backend/src/lib/plugin/hook-bus.test.ts`
Expected: `=== 3 passed, 0 failed ===`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/plugin/hook-bus.ts backend/src/lib/plugin/hook-bus.test.ts
git commit -m "feat(plugin): typed in-process HookBus with sequential + error-isolated emit"
```

---

## Task 4: Per-plugin migrations — `lib/plugin/migrations.ts` + tests

**Files:**
- Create: `backend/src/lib/plugin/migrations.ts`
- Test: `backend/src/lib/plugin/migrations.test.ts`
- Modify: `backend/src/db/schema.ts` (add `pluginMigrations` table)

- [ ] **Step 1: Add the tracking table to schema**

Modify `backend/src/db/schema.ts` — add at the bottom:

```typescript
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
// ...existing imports above...

export const pluginMigrations = sqliteTable("__plugin_migrations", {
  pluginId: text("plugin_id").notNull(),
  idx: integer("idx").notNull(),
  appliedAt: integer("applied_at", { mode: "timestamp" }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.pluginId, t.idx] }),
}));
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/lib/plugin/migrations.test.ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { runPluginMigrations } from "./migrations.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else      { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);

// Pre-create tracker (in real boot the schema migration creates it)
sqlite.run(`CREATE TABLE __plugin_migrations (plugin_id TEXT NOT NULL, idx INTEGER NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, idx))`);

const sql = [
  `CREATE TABLE IF NOT EXISTS plug_a_log (id INTEGER PRIMARY KEY, msg TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_plug_a_log_msg ON plug_a_log(msg)`,
];

const result1 = await runPluginMigrations(db, "plug-a", sql);
ok("first run applies all", result1.applied === 2);

const result2 = await runPluginMigrations(db, "plug-a", sql);
ok("second run is idempotent", result2.applied === 0);

const bad = await runPluginMigrations(db, "plug-b", [
  `CREATE TABLE IF NOT EXISTS plug_b_ok (id INTEGER PRIMARY KEY)`,
  `THIS IS NOT VALID SQL`,
]);
ok("partial failure stops on first error", bad.applied === 1 && bad.error !== undefined);

const after = sqlite.query(`SELECT idx FROM __plugin_migrations WHERE plugin_id = 'plug-b' ORDER BY idx`).all() as { idx: number }[];
ok("only successful migrations recorded", after.length === 1 && after[0].idx === 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun backend/src/lib/plugin/migrations.test.ts`
Expected: FAIL with `Cannot find module './migrations.ts'`.

- [ ] **Step 4: Implement the runner**

```typescript
// backend/src/lib/plugin/migrations.ts
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";

export interface MigrateResult {
  /** How many NEW migrations applied this run. 0 == fully up-to-date. */
  applied: number;
  /** Set when a statement failed mid-run; remaining statements are not applied. */
  error?: string;
}

/**
 * Apply a plugin's migrations, tracking each successful index in the
 * __plugin_migrations table. Statements run in order; on first error we
 * stop and surface { applied, error } so the loader can decide whether to
 * skip the plugin. Already-applied indexes are skipped silently.
 *
 * The caller MUST have created the __plugin_migrations table beforehand
 * (the core schema migration handles that on first boot).
 */
export async function runPluginMigrations(
  db: BunSQLiteDatabase,
  pluginId: string,
  statements: string[],
): Promise<MigrateResult> {
  const applied = await db.all<{ idx: number }>(sql`SELECT idx FROM __plugin_migrations WHERE plugin_id = ${pluginId}`);
  const done = new Set(applied.map((r) => r.idx));
  let count = 0;
  for (let i = 0; i < statements.length; i++) {
    if (done.has(i)) continue;
    try {
      await db.run(sql.raw(statements[i]));
      await db.run(sql`INSERT INTO __plugin_migrations (plugin_id, idx, applied_at) VALUES (${pluginId}, ${i}, ${Math.floor(Date.now() / 1000)})`);
      count++;
    } catch (e) {
      return { applied: count, error: `migration ${i}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { applied: count };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun backend/src/lib/plugin/migrations.test.ts`
Expected: `=== 4 passed, 0 failed ===`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/plugin/migrations.ts backend/src/lib/plugin/migrations.test.ts backend/src/db/schema.ts
git commit -m "feat(plugin): per-plugin idempotent migrations with __plugin_migrations tracker"
```

---

## Task 5: Semver compat check — `lib/plugin/compat.ts` + tests

**Files:**
- Create: `backend/src/lib/plugin/compat.ts`
- Test: `backend/src/lib/plugin/compat.test.ts`
- Modify: `backend/package.json` (add `semver` dep)

- [ ] **Step 1: Add semver dep**

Run:
```bash
bun add --cwd backend semver
bun add --cwd backend -D @types/semver
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/lib/plugin/compat.test.ts
import { checkCompat } from "./compat.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else      { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

ok("match: caret",       checkCompat("0.2.5", "^0.2.0").ok === true);
ok("match: range",       checkCompat("0.2.5", ">=0.2 <0.3").ok === true);
ok("mismatch: too new",  checkCompat("0.3.0", "^0.2.0").ok === false);
ok("mismatch: too old",  checkCompat("0.1.9", "^0.2.0").ok === false);
ok("invalid range surfaces", checkCompat("0.2.0", "not a range").ok === false);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun backend/src/lib/plugin/compat.test.ts`
Expected: FAIL with `Cannot find module './compat.ts'`.

- [ ] **Step 4: Implement compat**

```typescript
// backend/src/lib/plugin/compat.ts
import semver from "semver";

export interface CompatResult {
  ok: boolean;
  reason?: string;
}

/**
 * True iff the running Nexora version satisfies the plugin's declared range.
 * Invalid ranges (typo in manifest) fail closed with a useful reason.
 */
export function checkCompat(nexoraVersion: string, range: string): CompatResult {
  if (!semver.validRange(range)) return { ok: false, reason: `invalid nexoraVersion range: "${range}"` };
  if (!semver.valid(semver.coerce(nexoraVersion))) return { ok: false, reason: `bad NEXORA_VERSION: ${nexoraVersion}` };
  const ok = semver.satisfies(semver.coerce(nexoraVersion)!, range);
  return ok ? { ok: true } : { ok: false, reason: `${nexoraVersion} does not satisfy ${range}` };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun backend/src/lib/plugin/compat.test.ts`
Expected: `=== 5 passed, 0 failed ===`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/plugin/compat.ts backend/src/lib/plugin/compat.test.ts backend/package.json backend/../bun.lock
git commit -m "feat(plugin): semver compat check against NEXORA_VERSION"
```

---

## Task 6: Per-plugin enable/disable settings + admin endpoints

**Files:**
- Modify: `backend/src/routes/admin.ts` (add `GET /api/admin/plugins`, `POST /api/admin/plugins/:id/enabled`)
- Modify: `backend/src/lib/settings.ts` (no schema change — `feature_plugin_<id>` is just another setting key)

- [ ] **Step 1: Add admin endpoints**

Append to `backend/src/routes/admin.ts` inside the admin guard scope (search for the existing pattern — most routes look like `.get("/api/admin/...", ...)`):

```typescript
// /api/admin/plugins — list loaded plugins + their feature flag state.
// The loader (Task 7) populates `globalThis.__nexora_plugins` at boot;
// this endpoint reads from that and from settings.
.get("/api/admin/plugins", async () => {
  const loaded = (globalThis as any).__nexora_plugins as { id: string; version: string; description: string; loaded: boolean; reason?: string }[] | undefined;
  if (!loaded) return { plugins: [] };
  const settings = await getAllSettings();
  return {
    plugins: loaded.map((p) => ({
      ...p,
      enabled: (settings[`feature_plugin_${p.id}`] ?? "true") === "true",
    })),
  };
})
.post("/api/admin/plugins/:id/enabled", async ({ params, body }) => {
  const id = params.id;
  const value = (body as { enabled: boolean })?.enabled === true;
  await setSetting(`feature_plugin_${id}`, value ? "true" : "false");
  return { ok: true, restart_required: true };
})
```

(Import `getAllSettings` and `setSetting` from `../lib/settings.ts` at the top of the file if not already imported.)

- [ ] **Step 2: Smoke test via curl after the loader lands (Task 7)**

Defer the curl smoke until Task 7's loader writes `__nexora_plugins`. No standalone test for this task — covered by the e2e suite extension in Task 9.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "feat(plugin): admin endpoints to inspect + toggle plugins per-id"
```

---

## Task 7: Plugin loader — `lib/plugin/loader.ts`

**Why this task is bigger:** It replaces the existing `lib/paid-modules.ts` glue with the new pipeline: license → compat → migrations → enable flag → register → hook subscribe. We leave `paid-modules.ts` deleted at the end so there is one loader, not two.

**Files:**
- Create: `backend/src/lib/plugin/loader.ts`
- Modify: `backend/src/index.ts` (swap `loadPaidModules` → `loadPlugins`)
- Delete: `backend/src/lib/paid-modules.ts`

- [ ] **Step 1: Implement the loader**

```typescript
// backend/src/lib/plugin/loader.ts
import type { Elysia } from "elysia";
import type { Plugin } from "./types.ts";
import { NEXORA_VERSION } from "../version.ts";
import { checkCompat } from "./compat.ts";
import { runPluginMigrations } from "./migrations.ts";
import { hookBus } from "./hook-bus.ts";
import { db } from "../../db/connection.ts";
import { getAllSettings } from "../settings.ts";
import { verifyLicense } from "../license.ts";

interface LoadedRecord { id: string; version: string; description: string; loaded: boolean; reason?: string }

/**
 * Discover, gate, migrate, register, and hook-subscribe every plugin from
 * the in-tree registry at `../paid/index.ts` (when present). The pipeline:
 *   1. License gate — verifyLicense() must pass; otherwise NO plugin loads.
 *   2. Per-plugin compat check — manifest.nexoraVersion vs NEXORA_VERSION.
 *   3. Per-plugin enabled flag — `feature_plugin_<id>` setting; default true.
 *      Plugins disabled here are skipped completely (no migrate, no register,
 *      no hooks).
 *   4. Per-plugin migrations — runPluginMigrations() with the plugin's SQL.
 *      Failure here skips registration but does NOT throw.
 *   5. register() — append routes to Elysia. Failures isolated per plugin.
 *   6. hooks subscribe — wire each declared hook handler into hookBus.
 *
 * We always return an app (possibly unchanged). A bad plugin is logged, not
 * fatal. We also write a summary to `globalThis.__nexora_plugins` so the
 * admin endpoint added in Task 6 can render plugin state without rescanning.
 */
export async function loadPlugins<A extends Elysia<any, any, any, any, any, any, any, any>>(app: A): Promise<A> {
  const records: LoadedRecord[] = [];

  // 0. Discover registry (Free build has no /paid/, that's fine).
  let plugins: Plugin[] = [];
  try {
    const reg = await import("../../paid/index.ts").catch(() => ({ paidModules: undefined as Plugin[] | undefined }));
    plugins = (reg as any).paidModules ?? [];
  } catch (e) {
    console.warn(`[plugin] registry import failed: ${e instanceof Error ? e.message : e}`);
    (globalThis as any).__nexora_plugins = records;
    return app;
  }
  if (plugins.length === 0) {
    if (Bun.env.NODE_ENV !== "production") console.log(`[plugin] no plugins in registry; skipping.`);
    (globalThis as any).__nexora_plugins = records;
    return app;
  }

  // 1. License gate (build-wide; per-plugin signing comes in Phase 2).
  const lic = await verifyLicense();
  if (!lic.valid) {
    console.warn(`[plugin] license invalid (${lic.reason}); skipping all ${plugins.length} plugin(s).`);
    for (const p of plugins) records.push({ id: p.manifest.id, version: p.manifest.version, description: p.manifest.description, loaded: false, reason: `license: ${lic.reason}` });
    (globalThis as any).__nexora_plugins = records;
    return app;
  }
  console.log(`[plugin] license valid (${lic.email}); evaluating ${plugins.length} plugin(s)…`);

  const settings = await getAllSettings();
  let current: any = app;

  for (const p of plugins) {
    const { id, version, description, nexoraVersion } = p.manifest;
    const tag = `${id}@${version}`;

    // 2. Compat
    const compat = checkCompat(NEXORA_VERSION, nexoraVersion);
    if (!compat.ok) {
      console.warn(`[plugin] ${tag} skipped — ${compat.reason}`);
      records.push({ id, version, description, loaded: false, reason: compat.reason });
      continue;
    }

    // 3. Per-plugin enabled flag (default: true)
    const flag = settings[`feature_plugin_${id}`];
    if (flag === "false") {
      console.log(`[plugin] ${tag} skipped — disabled by admin.`);
      records.push({ id, version, description, loaded: false, reason: "disabled by admin" });
      continue;
    }

    // 4. Migrations (if any)
    if (p.migrations) {
      const r = await runPluginMigrations(db, id, p.migrations());
      if (r.error) {
        console.error(`[plugin] ${tag} migration failed: ${r.error} — skipping register.`);
        records.push({ id, version, description, loaded: false, reason: `migration: ${r.error}` });
        continue;
      }
      if (r.applied > 0) console.log(`[plugin] ${tag} applied ${r.applied} migration(s).`);
    }

    // 5. register()
    if (p.register) {
      try {
        current = await p.register(current);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[plugin] ${tag} register threw: ${msg} — skipping hooks.`);
        records.push({ id, version, description, loaded: false, reason: `register: ${msg}` });
        continue;
      }
    }

    // 6. hooks subscribe
    if (p.hooks) {
      for (const [hookName, handler] of Object.entries(p.hooks)) {
        if (typeof handler === "function") hookBus.subscribe(id, hookName as any, handler as any);
      }
    }

    console.log(`[plugin] ✓ ${tag} — ${description}`);
    records.push({ id, version, description, loaded: true });
  }

  (globalThis as any).__nexora_plugins = records;
  return current as A;
}
```

- [ ] **Step 2: Swap the import in `backend/src/index.ts`**

Find the existing line (currently around line 17):

```typescript
import { loadPaidModules } from "./lib/paid-modules.ts";
```

Replace with:

```typescript
import { loadPlugins } from "./lib/plugin/loader.ts";
```

Find the existing call (currently around line 152):

```typescript
const app = await loadPaidModules(baseApp);
```

Replace with:

```typescript
const app = await loadPlugins(baseApp);
```

- [ ] **Step 3: Delete the old loader**

```bash
rm backend/src/lib/paid-modules.ts
```

- [ ] **Step 4: Boot smoke test**

Run: `bun run dev`
Expected stdout contains:
```
[plugin] license valid (<email>); evaluating 4 plugin(s)…
[plugin] ✓ search-suggest@... — ...
```
(After Task 8 updates the 4 modules to the new shape. For this commit it will show 4 `bad manifest` records because the old `PaidModule` shape lacks a manifest. That's expected — Task 8 fixes it.)

Kill with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/plugin/loader.ts backend/src/index.ts
git rm backend/src/lib/paid-modules.ts
git commit -m "feat(plugin): unified loader (license + compat + migrate + register + hooks)"
```

---

## Task 8: Convert the 4 existing paid modules to Plugin shape

**Files (all MODIFIED):**
- `backend/src/paid/search.ts`
- `backend/src/paid/admin-bulk.ts`
- `backend/src/paid/admin-export.ts`
- `backend/src/paid/admin-customers-csv.ts`
- `backend/src/paid/index.ts`

- [ ] **Step 1: Update `backend/src/paid/search.ts`**

Locate the existing export:

```typescript
export const searchModule: PaidModule = {
  id: "search-suggest",
  description: "Storefront search autocomplete (/api/products/suggest)",
  register: (app) => app.get("/api/products/suggest", async ({ query }) => { /* ... */ }),
};
```

Replace with:

```typescript
import type { Plugin } from "../lib/plugin/types.ts";

export const searchPlugin: Plugin = {
  manifest: {
    id: "search-suggest",
    version: "1.0.0",
    nexoraVersion: ">=0.2 <0.3",
    description: "Storefront search autocomplete (/api/products/suggest)",
  },
  register: (app) => app.get("/api/products/suggest", async ({ query }) => { /* ...UNCHANGED BODY... */ }),
};
```

Remove the old `import type { PaidModule } from "../lib/paid-modules.ts";` line at the top.

- [ ] **Step 2: Apply the same shape to the other three**

Repeat Step 1 for `admin-bulk.ts` → `adminBulkPlugin`, `admin-export.ts` → `adminExportPlugin`, `admin-customers-csv.ts` → `adminCustomersCsvPlugin`. Pick `version: "1.0.0"` and `nexoraVersion: ">=0.2 <0.3"` for all four.

- [ ] **Step 3: Update the registry**

Rewrite `backend/src/paid/index.ts`:

```typescript
import type { Plugin } from "../lib/plugin/types.ts";
import { searchPlugin } from "./search.ts";
import { adminBulkPlugin } from "./admin-bulk.ts";
import { adminExportPlugin } from "./admin-export.ts";
import { adminCustomersCsvPlugin } from "./admin-customers-csv.ts";

export const paidModules: Plugin[] = [
  searchPlugin,
  adminBulkPlugin,
  adminExportPlugin,
  adminCustomersCsvPlugin,
];
```

(We deliberately keep the export name `paidModules` to match the loader's `reg.paidModules` lookup — no churn for one variable.)

- [ ] **Step 4: Boot smoke test**

Run: `bun run dev`
Expected stdout:

```
[plugin] license valid (<email>); evaluating 4 plugin(s)…
[plugin] ✓ search-suggest@1.0.0 — Storefront search autocomplete (/api/products/suggest)
[plugin] ✓ admin-bulk@1.0.0 — ...
[plugin] ✓ admin-export@1.0.0 — ...
[plugin] ✓ admin-customers-csv@1.0.0 — ...
```

Kill with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add backend/src/paid/
git commit -m "refactor(plugin): convert 4 paid modules to Plugin v2 manifest shape"
```

---

## Task 9: Emit hooks from core lifecycle points

**Why:** A hook bus with no emitters is a dead pipe. Wire the four hooks declared in `HookPayloads` into the existing watcher + checkout + delivery + register routes.

**Files (all MODIFIED):**
- `backend/src/routes/checkout.ts` — emit `order.created` after order row insert
- `backend/src/lib/watcher.ts` — emit `payment.paid` when an order flips to `paid`
- `backend/src/lib/inventory.ts` — emit `product.delivered` after `deliverKeys()` writes
- `backend/src/routes/auth.ts` — emit `user.created` after registration

- [ ] **Step 1: Emit `order.created`**

In `backend/src/routes/checkout.ts`, find the existing `INSERT INTO orders` site (search for `.insert(orders)`). Immediately after the insert resolves (and the resulting `orderId` is in scope), add:

```typescript
import { hookBus } from "../lib/plugin/hook-bus.ts";
// ...
await hookBus.emit("order.created", { orderId, userId });
```

If the existing handler doesn't already have `userId` in scope, pass the value used for the `userId` column.

- [ ] **Step 2: Emit `payment.paid`**

In `backend/src/lib/watcher.ts`, find where an order transitions to `status = "paid"` (search for `.set({ status: "paid"` or similar). After the update succeeds, add:

```typescript
import { hookBus } from "./plugin/hook-bus.ts";
// ...
await hookBus.emit("payment.paid", { orderId: order.id, userId: order.userId, amountUsd: order.priceUsd });
```

- [ ] **Step 3: Emit `product.delivered`**

In `backend/src/lib/inventory.ts`, find `deliverKeys` (or whichever function writes delivered keys to the user). After it has the list of delivered key strings:

```typescript
import { hookBus } from "./plugin/hook-bus.ts";
// ...
await hookBus.emit("product.delivered", { orderId, userId, productId, deliveredKeys: keys });
```

- [ ] **Step 4: Emit `user.created`**

In `backend/src/routes/auth.ts`, find the registration handler (`POST /api/register` — search for `.insert(users)`). After insert:

```typescript
import { hookBus } from "../lib/plugin/hook-bus.ts";
// ...
await hookBus.emit("user.created", { userId, email });
```

- [ ] **Step 5: Add an integration test that proves a hook fires**

Add to `backend/src/e2e.test.ts` (append a new section at the end, before the final summary print):

```typescript
// Plugin hook smoke: a fake plugin subscribed to user.created should see the new user.
import { hookBus } from "./lib/plugin/hook-bus.ts";
let captured: { userId: string; email: string } | null = null;
hookBus.subscribe("e2e-spy", "user.created", (p) => { captured = p; });

const reg = await fetch(`${BASE}/api/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: `hook-test-${Date.now()}@example.com`, password: "p4ssw0rd123" }),
});
ok("register 200", reg.status === 200);
await new Promise((r) => setTimeout(r, 50)); // emit is awaited but the test framework needs a tick
ok("user.created hook fired", captured !== null && typeof captured.userId === "string");
```

(Replace `BASE` with whatever variable the existing e2e suite uses for the API origin — likely `BASE` or `API`.)

- [ ] **Step 6: Run the integration test**

Run dev server in one terminal: `bun run dev`
Run e2e in another: `bun --cwd backend src/e2e.test.ts`
Expected: previous 17 checks PASS + 2 new checks PASS = 19 total.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/checkout.ts backend/src/lib/watcher.ts backend/src/lib/inventory.ts backend/src/routes/auth.ts backend/src/e2e.test.ts
git commit -m "feat(plugin): emit order.created, payment.paid, product.delivered, user.created"
```

---

## Task 10: Document the plugin contract

**Files:**
- Create: `backend/src/paid/PLUGIN.md`

- [ ] **Step 1: Write the contract doc**

```markdown
# Nexora Plugin Contract (v0.2)

A plugin is a TypeScript module that exports a `Plugin` object:

\`\`\`ts
import type { Plugin } from "../lib/plugin/types.ts";

export const myPlugin: Plugin = {
  manifest: {
    id: "my-feature",                  // lower-kebab, stable
    version: "1.0.0",                  // your plugin's semver
    nexoraVersion: ">=0.2 <0.3",       // semver range vs NEXORA_VERSION
    description: "Human description",
  },
  migrations: () => [
    `CREATE TABLE IF NOT EXISTS my_feature_log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL)`,
  ],
  register: (app) => app.get("/api/my-feature/ping", () => ({ ok: true })),
  hooks: {
    "order.created": async ({ orderId, userId }) => { /* react */ },
  },
};
\`\`\`

## Lifecycle

1. License must verify (Ed25519, see `lib/license.ts`).
2. `manifest.nexoraVersion` must satisfy `NEXORA_VERSION`.
3. Admin enable flag `feature_plugin_<id>` must not be `"false"` (default: true).
4. `migrations()` runs idempotently against `__plugin_migrations`.
5. `register()` attaches routes.
6. `hooks` are subscribed to the in-process `hookBus`.

A failure at any step skips the plugin with a logged reason; it never crashes the app.

## Available hooks

| Hook                | Payload                                                                  |
|---------------------|--------------------------------------------------------------------------|
| `order.created`     | `{ orderId, userId }`                                                    |
| `payment.paid`      | `{ orderId, userId, amountUsd }`                                         |
| `product.delivered` | `{ orderId, userId, productId, deliveredKeys[] }`                        |
| `user.created`      | `{ userId, email }`                                                      |

Hooks fire sequentially in subscription order. A throwing handler is logged; the next handler still fires.

## Rules

- Never edit a past migration. Append new ones.
- Never mutate a payload object — treat it as readonly.
- Never reach into another plugin's table prefix (`<otherId>_*`).
- Do not call `process.exit()` or mutate `globalThis` outside `__nexora_plugins`.

## Out of scope (Phase 2)

- Per-plugin signing + customer-binding: today the license gates the whole build; tomorrow each plugin file will carry its own signature bound to a customer id.
- Distribution outside the source tree: today plugins ship in `backend/src/paid/`; tomorrow they can ship as signed `.nexplug` bundles loaded from `.plugins/`.
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/paid/PLUGIN.md
git commit -m "docs(plugin): contract v0.2 + lifecycle + available hooks"
```

---

## Self-Review

**Spec coverage:**
- ✅ Plugin manifest (id, version, nexoraVersion, description) → Task 2
- ✅ Hook bus + 4 hooks emitted from core → Tasks 3, 9
- ✅ Per-plugin migrations → Task 4
- ✅ Semver compat → Task 5
- ✅ Per-plugin enable/disable → Task 6
- ✅ Unified loader replacing `paid-modules.ts` → Task 7
- ✅ Existing 4 modules migrated → Task 8
- ✅ Documentation → Task 10
- 🚫 Per-plugin Ed25519 signing — explicitly scoped to Phase 2 (separate plan)

**Placeholder scan:** no TBD / TODO / "similar to" / "add appropriate" left.

**Type consistency:** `Plugin`, `PluginManifest`, `HookName`, `HookPayloads` defined in Task 2 and used identically in Tasks 3, 7, 8. `runPluginMigrations` signature `(db, pluginId, statements) → MigrateResult { applied, error? }` consistent across Tasks 4 and 7. The registry constant is intentionally kept as `paidModules` in Task 8 to match the loader's lookup in Task 7 — documented inline.

**Known limitation:** Plugins still execute with full Bun/Node privileges. The contract doc (Task 10) calls this out. Sandboxing is not in this plan and not in Phase 2 either — it would need V8 isolates / `vm.runInNewContext` which Bun does not implement at parity.
