import { createContext, useCallback, useContext, useEffect, useState } from "react";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import vi from "./locales/vi.json";
import zh from "./locales/zh.json";

export type Locale = "en" | "vi" | "zh" | "es" | "de";

export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
];

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { en, vi, zh, es, de };
const FALLBACK: Locale = "en";
const STORAGE_KEY = "nx_locale";

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

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const hit = lookup(DICTS[locale], key) ?? lookup(DICTS[FALLBACK], key);
  if (hit == null) return key;
  return interpolate(hit, vars);
}

export function detectLocale(): Locale {
  if (typeof window === "undefined") return FALLBACK;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && saved in DICTS) return saved;
  } catch {}
  const nav = (window.navigator?.language || "").toLowerCase();
  if (nav.startsWith("vi")) return "vi";
  if (nav.startsWith("zh")) return "zh";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("de")) return "de";
  return FALLBACK;
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nCtx>({
  locale: FALLBACK,
  setLocale: () => {},
  // Default outside any provider — fall through to the English dictionary
  // instead of echoing the raw key. Without this, any React island that
  // doesn't sit inside I18nProvider (e.g. SetupWizard rendered standalone
  // via client:idle) would show literal keys like "storefront.auth.show".
  t: (key, vars) => translate(FALLBACK, key, vars),
});

export function useT() {
  return useContext(I18nContext);
}

export function useI18nState() {
  const [locale, setLocaleState] = useState<Locale>(FALLBACK);
  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
      document.documentElement.lang = l;
    } catch {}
  }, []);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
  return { locale, setLocale, t };
}
