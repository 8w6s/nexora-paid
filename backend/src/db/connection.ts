import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/nexora";
const client = postgres(connectionString);

/**
 * Minimal forward-only PostgreSQL migrator.
 */
async function runMigrations(sqlClient: postgres.Sql): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "migrations");
  if (!existsSync(dir)) return;

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return;
  }
  if (files.length === 0) return;

  await sqlClient.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const appliedRows = await sqlClient.unsafe("SELECT filename FROM _migrations");
  const applied = new Set(appliedRows.map((r: any) => r.filename as string));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlContent = readFileSync(join(dir, file), "utf8");

    // Execute migration in a Postgres transaction block
    await sqlClient.begin(async (tx) => {
      await tx.unsafe(sqlContent);
      await tx.unsafe("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
    });
  }
}

// Boot up migrations asynchronously
runMigrations(client).catch((e) => {
  console.error("Database migration error on startup:", e);
});

export const db = drizzle(client, { schema });
