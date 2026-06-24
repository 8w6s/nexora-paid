import type React from "react";
import { useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./Toast";

export const AccountEmailCard: React.FC = () => {
  const { user, refresh } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      toast.error(t("storefront.account.invalidEmail"));
      return;
    }
    if (trimmed === user?.email) {
      toast.error(t("storefront.account.sameEmail"));
      return;
    }
    if (!current) {
      toast.error(t("storefront.account.currentPasswordRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{
        ok: boolean;
        email: string;
        revokedSessions: number;
      }>("/api/auth/change-email", {
        currentPassword: current,
        newEmail: trimmed,
      });
      const revoked = res.revokedSessions ?? 0;
      toast.success(
        revoked > 0
          ? t("storefront.account.emailUpdatedWithRevoked", {
              email: res.email,
              count: revoked,
            })
          : t("storefront.account.emailUpdated", { email: res.email }),
      );
      setNewEmail("");
      setCurrent("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_CURRENT") toast.error(t("storefront.account.badCurrentPassword"));
        else if (err.code === "EMAIL_TAKEN") toast.error(t("storefront.account.emailTaken"));
        else if (err.code === "SAME_EMAIL") toast.error(t("storefront.account.sameEmail"));
        else if (err.code === "RATE_LIMITED") toast.error(t("storefront.errors.rateLimited"));
        else toast.error(err.message || t("storefront.account.emailUpdateFailed"));
      } else {
        toast.error(err instanceof Error ? err.message : t("storefront.account.emailUpdateFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card acct-card">
      <div className="acct-head">
        <h2>{t("storefront.account.changeEmail")}</h2>
        <p className="sub">{t("storefront.account.changeEmailHint")}</p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>{t("storefront.account.currentEmail")}</span>
          <input className="input" type="email" value={user?.email ?? ""} disabled readOnly />
        </label>
        <label>
          <span>{t("storefront.account.newEmail")}</span>
          <input
            className="input"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label>
          <span>{t("storefront.account.currentPassword")}</span>
          <PasswordInput
            value={current}
            onChange={setCurrent}
            required
            placeholder={t("storefront.account.confirmIdentity")}
            autoComplete="current-password"
          />
        </label>
        <div className="acct-actions">
          <button className="btn" type="submit" disabled={busy || !newEmail.trim() || !current}>
            {busy ? (
              <>
                <Icon name="spinner" size={16} className="is-spinning" />
                <span>{t("common.loading")}</span>
              </>
            ) : (
              <span>{t("storefront.account.updateEmail")}</span>
            )}
          </button>
        </div>
      </form>
      <style>{`
        .acct-card { padding: 26px 28px; }
        .acct-head h2 { font-size: 1.15rem; margin-bottom: 4px; }
        .sub { color: var(--ink-soft); font-size: .86rem; margin-bottom: 20px; line-height: 1.5; }
        form { display: flex; flex-direction: column; gap: 14px; }
        label { display: flex; flex-direction: column; gap: 6px; font-size: .8rem; font-weight: 600; color: var(--ink-soft); }
        .input:disabled { opacity: .7; cursor: not-allowed; }
        .acct-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
      `}</style>
    </section>
  );
};