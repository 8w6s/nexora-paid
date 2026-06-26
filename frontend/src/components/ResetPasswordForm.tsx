import type React from "react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";

export const ResetPasswordForm: React.FC = () => {
  const { t } = useT();
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!/^[0-9a-f]{64}$/i.test(raw)) {
      setTokenError(t("storefront.auth.resetTokenInvalid"));
      return;
    }
    setToken(raw);
  }, [t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("storefront.auth.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("storefront.auth.passwordsDontMatch"));
      return;
    }
    if (!token) {
      setError(t("storefront.auth.resetTokenMissing"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/reset", { token, password });
      window.location.assign("/orders");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_TOKEN") {
          setError(t("storefront.auth.resetTokenExpired"));
        } else if (err.code === "RATE_LIMITED") {
          setError(t("storefront.errors.rateLimited"));
        } else {
          setError(err.message || t("storefront.auth.resetFailed"));
        }
      } else {
        setError(err instanceof Error ? err.message : t("storefront.auth.resetFailed"));
      }
      setBusy(false);
    }
  };

  return (
    <main className="container auth-page">
      <div className="auth-card card">
        <h1>{t("storefront.auth.chooseNewPassword")}</h1>
        {tokenError ? (
          <>
            <p className="sub">{tokenError}</p>
            <p className="switch">
              <a href="/forgot" style={{ color: "var(--brand)", fontWeight: 600 }}>
                {t("storefront.auth.requestNewResetLink")}
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="sub">{t("storefront.auth.resetPickHint")}</p>
            <form method="post" onSubmit={submit}>
              <label>
                <span>{t("storefront.auth.newPassword")}</span>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  required
                  minLength={8}
                  placeholder={t("storefront.auth.passwordHint")}
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>{t("storefront.auth.confirmPassword")}</span>
                <PasswordInput
                  value={confirm}
                  onChange={setConfirm}
                  required
                  minLength={8}
                  placeholder={t("storefront.auth.confirmPasswordPlaceholder")}
                  autoComplete="new-password"
                />
              </label>
              {error && <div className="auth-error">{error}</div>}
              <button
                className="btn"
                type="submit"
                disabled={busy || !password || !confirm || !token}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {busy ? (
                  <>
                    <Icon name="spinner" size={17} className="is-spinning" />
                    <span>{t("common.loading")}</span>
                  </>
                ) : (
                  <span>{t("storefront.auth.setNewPassword")}</span>
                )}
              </button>
            </form>
          </>
        )}
      </div>
      <style>{`
        .auth-page { display: flex; justify-content: center; padding: 50px 20px; }
        .auth-card { width: 100%; max-width: 400px; padding: 30px 28px; }
        .auth-card h1 { font-size: 1.5rem; margin-bottom: 6px; }
        .sub { color: var(--ink-soft); font-size: .9rem; margin-bottom: 22px; line-height: 1.5; }
        form { display: flex; flex-direction: column; gap: 16px; }
        label { display: flex; flex-direction: column; gap: 6px; font-size: .82rem; font-weight: 600; color: var(--ink-soft); }
        .auth-error { background: var(--price-soft); color: var(--price); padding: 10px 13px; border-radius: var(--radius-sm); font-size: .84rem; }
        .switch { margin-top: 18px; text-align: center; font-size: .86rem; color: var(--ink-soft); }
      `}</style>
    </main>
  );
};
