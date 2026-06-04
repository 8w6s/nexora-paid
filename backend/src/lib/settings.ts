import { db } from "../db/connection.ts";
import { settings } from "../db/schema.ts";

// Small cached key/value settings store. Invalidate after writes.
let cache: Record<string, string | null> | null = null;

export async function getAllSettings(): Promise<Record<string, string | null>> {
  if (cache) return cache;
  const rows = await db.select().from(settings);
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return cache;
}

export async function getSetting(key: string): Promise<string | null> {
  return (await getAllSettings())[key] ?? null;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  invalidateSettings();
}

export function invalidateSettings(): void {
  cache = null;
}
