import type React from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { api } from "../lib/api";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  locale?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  /** code is the optional 6-digit TOTP, only required when the account has 2FA enabled. */
  login: (email: string, password: string, code?: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCALE_ALLOWED: ReadonlySet<string> = new Set(["en", "vi", "zh", "es", "de"]);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { locale, setLocale } = useT();
  const lastPushedLocale = useRef<string | null>(null);

  // Hydrate from /api/auth/me. Backend returns {user: AuthUser | null} —
  // 200 in both cases so an anonymous visitor doesn't log a red 401 in
  // devtools on every page load. Network/parse failures still fall back
  // to the loged-out state silently.
  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: AuthUser | null }>("/api/auth/me");
      setUser(res.user);
    } catch (err) {
      setUser(null);
      void err;
    }
  }, []);

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

  // Adopt user's saved locale once when auth resolves. After that, the user
  // can still switch via the UI; the next effect pushes that change to the
  // server so other devices pick it up.
  useEffect(() => {
    if (!user) return;
    const serverLocale = user.locale ?? null;
    if (serverLocale && LOCALE_ALLOWED.has(serverLocale) && serverLocale !== locale) {
      setLocale(serverLocale as Parameters<typeof setLocale>[0]);
      lastPushedLocale.current = serverLocale;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Push locale changes to the server when logged in. Skip the no-op echo
  // that the adopt-effect above sets via lastPushedLocale.
  useEffect(() => {
    if (!user) return;
    if (!LOCALE_ALLOWED.has(locale)) return;
    if (lastPushedLocale.current === locale) return;
    lastPushedLocale.current = locale;
    api.patch("/api/auth/locale", { locale }).catch(() => {
      // Non-fatal: localStorage already has it; let the next change retry.
      lastPushedLocale.current = null;
    });
  }, [user?.id, locale]);

  const login = useCallback(
    async (email: string, password: string, code?: string) => {
      // `code` is sent only when the user already typed it. Backend returns
      // a TOTP_REQUIRED error code on first attempt for 2FA accounts; the
      // form catches it and re-submits with the code attached.
      await api.post("/api/auth/login", code ? { email, password, code } : { email, password });
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      await api.post("/api/auth/register", { email, password });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

/** Same as useAuth but returns null when used outside an AuthProvider.
 *  Safe for providers/components that legitimately render at the very top
 *  of the tree (e.g. LocaleProvider) and only need auth opportunistically. */
export const useAuthOptional = () => useContext(AuthContext);
