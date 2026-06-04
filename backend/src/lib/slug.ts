import { eq } from "drizzle-orm";
import { db } from "../db/connection.ts";
import { products } from "../db/schema.ts";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";
}

// Ensure slug uniqueness by appending -2, -3, ... when taken (ignoring an optional self id).
export async function uniqueSlug(base: string, selfId?: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  for (;;) {
    const rows = await db.select().from(products).where(eq(products.slug, candidate));
    const taken = rows.some((r) => r.id !== selfId);
    if (!taken) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}
