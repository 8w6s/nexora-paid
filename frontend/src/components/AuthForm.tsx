import type React from "react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";

export const AuthForm: React.FC<{ mode: "login" | "register" }> = ({ mode }) => {
  const { login, register } = useAuth();
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [querySearch, setQuerySearch] = useState("");
  useEffect(() => {
    setQuerySearch(window.location.search);
  }, []);

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
      if (err instanceof ApiRequestError && err.code === "TOTP_REQUIRED") {
        setNeeds2fa(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : t("storefront.errors.generic"));
      }
      setBusy(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <main className="container auth-page">
      <div className="auth-card card">
        <h1>{isLogin ? t("storefront.auth.signIn") : t("storefront.auth.createAccount")}</h1>
        <p className="sub">
          {isLogin ? t("storefront.auth.welcomeBack") : t("storefront.auth.signupHint")}
        </p>
        <form onSubmit={submit}>
          {!needs2fa && (
            <>
              <label>
                <span>{t("storefront.auth.email")}</span>
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
                <span>{t("storefront.auth.password")}</span>
                <PasswordInput
                  id="auth-password"
                  name="password"
                  value={password}
                  onChange={setPassword}
                  required
                  minLength={isLogin ? undefined : 8}
                  placeholder={
                    isLogin
                      ? t("storefront.auth.passwordPlaceholder")
                      : t("storefront.auth.passwordHint")
                  }
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
              </label>
            </>
          )}
          {needs2fa && (
            <label>
              <span>{t("storefront.auth.twoFactorCode")}</span>
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
              <span className="hint">{t("storefront.auth.twoFactorHint")}</span>
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
                <span>{t("common.loading")}</span>
              </>
            ) : (
              <span>
                {needs2fa
                  ? t("storefront.auth.verifyAndSignIn")
                  : isLogin
                    ? t("storefront.auth.signIn")
                    : t("storefront.auth.createAccount")}
              </span>
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
              {t("common.back")}
            </button>
          )}
        </form>
        {!needs2fa && isLogin && (
          <p className="forgot-line">
            <a href="/forgot">{t("storefront.auth.forgotPassword")}</a>
          </p>
        )}
        {!needs2fa && (
          <p className="switch">
            {isLogin ? (
              <>
                {t("storefront.auth.noAccount")}{" "}
                <a href={`/register${querySearch}`}>{t("storefront.auth.createOne")}</a>
              </>
            ) : (
              <>
                {t("storefront.auth.haveAccount")}{" "}
                <a href={`/login${querySearch}`}>{t("storefront.auth.signIn")}</a>
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
        .forgot-line { margin-top: 12px; text-align: right; font-size: .82rem; }
        .forgot-line a { color: var(--ink-soft); text-decoration: none; }
        .forgot-line a:hover { color: var(--brand); text-decoration: underline; }
        .switch { margin-top: 18px; text-align: center; font-size: .86rem; color: var(--ink-soft); }
        .switch a { color: var(--brand); font-weight: 600; text-decoration: none; }
        .switch a:hover { text-decoration: underline; }
      `}</style>
    </main>
  );
};
