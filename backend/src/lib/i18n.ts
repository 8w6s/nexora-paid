// Server-side i18n for emails + API messages. Mirrors frontend/src/i18n/index.ts
// but lives on the backend so email templates can pick the recipient's locale.
// Locale dictionaries are shipped INSIDE the backend image (./locales/*.json)
// so the import path stays inside `/app/`. They are kept in sync with the
// frontend copies via `scripts/sync-i18n-to-backend.sh` (run before each
// release); the duplication is deliberate — backend and frontend are
// separately deployed Docker images and the prior cross-tree relative
// import (../../../frontend/...) broke every build that didn't ship the
// frontend folder alongside the backend.
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import vi from "./locales/vi.json";
import zh from "./locales/zh.json";

export type Locale = "en" | "vi" | "zh" | "es" | "de";
type Dict = Record<string, unknown>;

const DICTS: Record<Locale, Dict> = { en, vi, zh, es, de };
const FALLBACK: Locale = "en";

function lookup(dict: Dict, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function t(
  locale: Locale | string | null | undefined,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const loc: Locale = locale && (locale as string) in DICTS ? (locale as Locale) : FALLBACK;
  const hit = lookup(DICTS[loc], key) ?? lookup(DICTS[FALLBACK], key);
  if (hit == null) return key;
  return interpolate(hit, vars);
}

// Parse Accept-Language header → best supported locale (or FALLBACK).
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return FALLBACK;
  const tags = header
    .split(",")
    .map((p) => {
      const [tag, q] = p.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    if (tag.startsWith("vi")) return "vi";
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("de")) return "de";
    if (tag.startsWith("en")) return "en";
  }
  return FALLBACK;
}
