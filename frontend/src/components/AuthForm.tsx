import type React from "react";
import { useState } from "react";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";

export const AuthForm: React.FC<{ mode: "login" | "register" }> = ({ mode }) => {
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTarget = () => {
    if (typeof window === "undefined") return "/";
    return new URLSearchParams(window.location.search).get("redirect") || "/";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password);
      window.location.assign(redirectTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  const isLogin = mode === "login";
  return (
    <main className="container auth-page">
      <div className="auth-card card">
        <h1>{isLogin ? "Sign in" : "Create your account"}</h1>
        <p className="sub">
          {isLogin ? "Welcome back to Nexora." : "Sign up to buy digital goods with Litecoin."}
        </p>
        <form onSubmit={submit}>
          <label>
            <span>Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            <span>Password</span>
            <PasswordInput
              value={password}
              onChange={setPassword}
              required
              minLength={isLogin ? undefined : 8}
              placeholder={isLogin ? "Your password" : "At least 8 characters"}
              autoComplete={isLogin ? "current-password" : "new-password"}
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button
            className="btn"
            type="submit"
            disabled={busy}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {busy ? (
              <>
                <Icon name="spinner" size={17} className="is-spinning" />
                <span>Please wait…</span>
              </>
            ) : (
              <span>{isLogin ? "Sign in" : "Create account"}</span>
            )}
          </button>
        </form>
        <p className="switch">
          {isLogin ? (
            <>
              No account? <a href="/register">Create one</a>
            </>
          ) : (
            <>
              Already have an account? <a href="/login">Sign in</a>
            </>
          )}
        </p>
      </div>
      <style>{`
        .auth-page { display: flex; justify-content: center; padding: 50px 20px; }
        .auth-card { width: 100%; max-width: 400px; padding: 30px 28px; }
        .auth-card h1 { font-size: 1.5rem; margin-bottom: 6px; }
        .sub { color: var(--ink-soft); font-size: .9rem; margin-bottom: 22px; }
        form { display: flex; flex-direction: column; gap: 16px; }
        label { display: flex; flex-direction: column; gap: 6px; font-size: .82rem; font-weight: 600; color: var(--ink-soft); }
        .auth-error { background: var(--price-soft); color: var(--price); padding: 10px 13px; border-radius: var(--radius-sm); font-size: .84rem; }
        .switch { margin-top: 18px; text-align: center; font-size: .86rem; color: var(--ink-soft); }
        .switch a { color: var(--brand); font-weight: 600; }
      `}</style>
    </main>
  );
};
