import type React from "react";
import { useState } from "react";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";

export const AuthForm: React.FC<{ mode: "login" | "register" }> = ({ mode }) => {
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // 2FA second-step state. The first submit is email+password; if the backend
  // signals TOTP_REQUIRED, we flip needs2fa=true and re-render the form with a
  // code input. Email/password stays in state so the user doesn't retype.
  const [code, setCode] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
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
      if (mode === "login") await login(email.trim(), password, needs2fa ? code : undefined);
      else await register(email.trim(), password);
      window.location.assign(redirectTarget());
    } catch (err) {
      // TOTP_REQUIRED is not a hard failure — the password was right, the
      // server just wants the second factor. Promote to step 2 instead of
      // showing a red error banner.
      if (err instanceof ApiRequestError && err.code === "TOTP_REQUIRED") {
        setNeeds2fa(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
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
          {!needs2fa && (
            <>
              <label>
                <span>Email</span>
                <input
                  id="auth-email"
                  name="email"
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
                id="auth-password"
                  name="password"
                  value={password}
                onChange={setPassword}
                  required
                  minLength={isLogin ? undefined : 8}
                  placeholder={isLogin ? "Your password" : "At least 8 characters"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
              </label>
            </>
          )}
          {needs2fa && (
            <label>
              <span>Two-factor code</span>
              <input
                id="auth-totp"
                name="totp"
                className="input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                placeholder="123456"
                autoComplete="one-time-code"
                autoFocus
              />
              <span className="hint">Open your authenticator app and enter the 6-digit code.</span>
            </label>
          )}
          {error && <div className="auth-error">{error}</div>}
          <button
            className="btn"
            type="submit"
            disabled={busy || (needs2fa && code.length !== 6)}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {busy ? (
              <>
                <Icon name="spinner" size={17} className="is-spinning" />
                <span>Please wait…</span>
              </>
            ) : (
              <span>{needs2fa ? "Verify & sign in" : isLogin ? "Sign in" : "Create account"}</span>
            )}
          </button>
          {needs2fa && (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setNeeds2fa(false);
                setCode("");
                setError(null);
              }}
              style={{ alignSelf: "center" }}
            >
              Back
            </button>
          )}
        </form>
        {!needs2fa && (
          <p className="switch">
            {isLogin ? (
              <>
                No account?{" "}
                <span
                  style={{ cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}
                  onClick={() => {
                    window.location.href = `/register${window.location.search}`;
                  }}
                >
                  Create one
                </span>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <span
                  style={{ cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}
                  onClick={() => {
                    window.location.href = `/login${window.location.search}`;
                  }}
                >
                  Sign in
                </span>
              </>
            )}
          </p>
        )}
      </div>
      <style>{`
        .auth-page { display: flex; justify-content: center; padding: 50px 20px; }
        .auth-card { width: 100%; max-width: 400px; padding: 30px 28px; }
        .auth-card h1 { font-size: 1.5rem; margin-bottom: 6px; }
        .sub { color: var(--ink-soft); font-size: .9rem; margin-bottom: 22px; }
        form { display: flex; flex-direction: column; gap: 16px; }
        label { display: flex; flex-direction: column; gap: 6px; font-size: .82rem; font-weight: 600; color: var(--ink-soft); }
        .hint { font-size: .76rem; color: var(--ink-faint); font-weight: 400; }
        .auth-error { background: var(--price-soft); color: var(--price); padding: 10px 13px; border-radius: var(--radius-sm); font-size: .84rem; }
        .switch { margin-top: 18px; text-align: center; font-size: .86rem; color: var(--ink-soft); }
        .switch a { color: var(--brand); font-weight: 600; }
      `}</style>
    </main>
  );
};