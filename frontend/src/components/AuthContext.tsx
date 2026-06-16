import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate from /api/auth/me. Swallow 401 (not logged in) as null.
  const refresh = useCallback(async () => {
    try {
      const me = await api.get<AuthUser>("/api/auth/me");
      setUser(me);
    } catch (err) {
      // 401 = not logged in; any other error = treat as logged out without throwing.
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