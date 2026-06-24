import { sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

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
  const applied = await db.all<{ idx: number }>(
    sql`SELECT idx FROM __plugin_migrations WHERE plugin_id = ${pluginId}`,
  );
  const done = new Set(applied.map((r) => r.idx));
  let count = 0;
  for (let i = 0; i < statements.length; i++) {
    if (done.has(i)) continue;
    try {
      await db.run(sql.raw(statements[i]));
      await db.run(
        sql`INSERT INTO __plugin_migrations (plugin_id, idx, applied_at) VALUES (${pluginId}, ${i}, ${Date.now()})`,
      );
      count++;
    } catch (e) {
      return {
        applied: count,
        error: `migration ${i}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  return { applied: count };
}
