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
