import type React from "react";
import { useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";

export const ForgotPasswordForm: React.FC = () => {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/forgot", { email: email.trim() });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "RATE_LIMITED") {
        setError(t("storefront.errors.rateLimited"));
      } else {
        setError(err instanceof Error ? err.message : t("storefront.errors.generic"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container auth-page">
      <div className="auth-card card">
        <h1>{t("storefront.auth.resetTitle")}</h1>
        {sent ? (
          <>
            <p className="sub">{t("storefront.auth.resetSent", { email })}</p>
            <p className="switch">
              <a href="/login" style={{ color: "var(--brand)", fontWeight: 600 }}>
                ← {t("storefront.auth.backToSignIn")}
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="sub">{t("storefront.auth.resetHint")}</p>
            <form method="post" onSubmit={submit}>
              <label>
                <span>{t("storefront.auth.email")}</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                />
              </label>
              {error && <div className="auth-error">{error}</div>}
              <button
                className="btn"
                type="submit"
                disabled={busy || !email.trim()}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {busy ? (
                  <>
                    <Icon name="spinner" size={17} className="is-spinning" />
                    <span>{t("common.loading")}</span>
                  </>
                ) : (
                  <span>{t("storefront.auth.sendResetLink")}</span>
                )}
              </button>
            </form>
            <p className="switch">
              {t("storefront.auth.rememberedIt")}{" "}
              <a href="/login" style={{ color: "var(--brand)", fontWeight: 600 }}>
                {t("storefront.auth.signIn")}
              </a>
            </p>
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
