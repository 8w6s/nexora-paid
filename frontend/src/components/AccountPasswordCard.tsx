import type React from "react";
import { useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./Toast";

export const AccountPasswordCard: React.FC = () => {
  const { t } = useT();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      toast.error(t("storefront.auth.passwordTooShort"));
      return;
    }
    if (next !== confirm) {
      toast.error(t("storefront.auth.passwordsDontMatch"));
      return;
    }
    if (next === current) {
      toast.error(t("storefront.account.samePassword"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/auth/change-password",
        { currentPassword: current, newPassword: next },
      );
      const revoked = res.revokedSessions ?? 0;
      toast.success(
        revoked > 0
          ? t("storefront.account.passwordUpdatedWithRevoked", { count: revoked })
          : t("storefront.account.passwordUpdated"),
      );
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_CURRENT") {
          toast.error(t("storefront.account.badCurrentPassword"));
        } else if (err.code === "SAME_PASSWORD") {
          toast.error(t("storefront.account.samePassword"));
        } else if (err.code === "RATE_LIMITED") {
          toast.error(t("storefront.errors.rateLimited"));
        } else {
          toast.error(err.message || t("storefront.account.passwordUpdateFailed"));
        }
      } else {
        toast.error(
          err instanceof Error ? err.message : t("storefront.account.passwordUpdateFailed"),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card acct-card">
      <div className="acct-head">
        <h2>{t("storefront.account.changePassword")}</h2>
        <p className="sub">{t("storefront.account.changePasswordHint")}</p>
      </div>
      <form method="post" onSubmit={submit}>
        <label>
          <span>{t("storefront.account.currentPassword")}</span>
          <PasswordInput
            value={current}
            onChange={setCurrent}
            required
            placeholder={t("storefront.account.currentPasswordPlaceholder")}
            autoComplete="current-password"
          />
        </label>
        <label>
          <span>{t("storefront.auth.newPassword")}</span>
          <PasswordInput
            value={next}
            onChange={setNext}
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
        <div className="acct-actions">
          <button className="btn" type="submit" disabled={busy || !current || !next || !confirm}>
            {busy ? (
              <>
                <Icon name="spinner" size={16} className="is-spinning" />
                <span>{t("common.loading")}</span>
              </>
            ) : (
              <span>{t("storefront.account.updatePassword")}</span>
            )}
          </button>
        </div>
      </form>
      <style>{`
        .acct-card { padding: 26px 28px; }
        .acct-head h2 { font-size: 1.15rem; margin-bottom: 4px; }
        .sub { color: var(--ink-soft); font-size: .86rem; margin-bottom: 20px; }
        form { display: flex; flex-direction: column; gap: 14px; }
        label { display: flex; flex-direction: column; gap: 6px; font-size: .8rem; font-weight: 600; color: var(--ink-soft); }
        .acct-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
      `}</style>
    </section>
  );
};
