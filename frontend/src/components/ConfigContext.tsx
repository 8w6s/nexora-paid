import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import { runThemeCurtain } from "../lib/themeTransition";

export interface StoreConfig {
  storeName: string;
  needsSetup: boolean;
  faKitUrl: string | null;
  features: Record<string, boolean>;
}

const DEFAULT: StoreConfig = {
  storeName: "Nexora",
  needsSetup: false,
  faKitUrl: null,
  features: {},
};

export type Theme = "light" | "dark";

interface ConfigCtx {
  config: StoreConfig;
  loading: boolean;
  isOn: (feature: string) => boolean;
  refresh: () => Promise<void>;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const Ctx = createContext<ConfigCtx | undefined>(undefined);

// localStorage key is the canonical lowercase form. Older builds wrote to
// "gemvn-theme" (pre-rebrand) and to "Nexora-theme" (Antigravity-introduced
// mixed-case typo); both are migrated to "nexora-theme" on first read so a
// returning visitor doesn't lose their preference.
const THEME_KEY = "nexora-theme";
const LEGACY_THEME_KEYS = ["Nexora-theme", "gemvn-theme"];

const initialTheme = (): Theme => {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark" || attr === "light") return attr;
  try {
    let s = localStorage.getItem(THEME_KEY);
    if (s !== "dark" && s !== "light") {
      for (const k of LEGACY_THEME_KEYS) {
        const v = localStorage.getItem(k);
        if (v === "dark" || v === "light") {
          s = v;
          localStorage.setItem(THEME_KEY, v);
          localStorage.removeItem(k);
          break;
        }
      }
    }
    if (s === "dark" || s === "light") return s;
  } catch {}
  return "light";
};

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<StoreConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  // Internal: actually flip the theme + persist. Called by the curtain mid-animation.
  const applyTheme = (t: Theme) => {
    setThemeState(t);
    if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  };
  const setTheme = (t: Theme) => {
    if (t === theme) return;
    runThemeCurtain(t, () => applyTheme(t));
  };
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const refresh = async () => {
    try {
      setConfig(await api.get<StoreConfig>("/api/config"));
    } catch {
      setConfig(DEFAULT);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      await refresh();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  // Inject the Font Awesome Pro Kit once we know the URL (client-side).
  useEffect(() => {
    const url = config.faKitUrl;
    if (!url || typeof document === "undefined") return;
    if (document.querySelector(`script[data-fa-kit]`)) return;
    const s = document.createElement("script");
    s.src = url;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-fa-kit", "1");
    document.head.appendChild(s);
  }, [config.faKitUrl]);

  const isOn = (feature: string) => config.features[feature] !== false; // default-on if unknown

  return (
    <Ctx.Provider value={{ config, loading, isOn, refresh, theme, setTheme, toggleTheme }}>
      {children}
    </Ctx.Provider>
  );
};

export const useConfig = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfig must be used within a ConfigProvider");
  return c;
};
