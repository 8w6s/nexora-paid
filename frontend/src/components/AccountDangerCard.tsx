import type React from "react";
import { useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./Toast";

export const AccountDangerCard: React.FC = () => {
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setConfirm("");
    setCurrent("");
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirm.trim() !== "DELETE") {
      toast.error(t("storefront.account.typeDeleteToConfirm"));
      return;
    }
    if (!current) {
      toast.error(t("storefront.account.currentPasswordRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/delete-account", { currentPassword: current });
      toast.success(t("storefront.account.deleteSuccess"));
      window.setTimeout(() => window.location.assign("/"), 1200);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_CURRENT") toast.error(t("storefront.account.badCurrentPassword"));
        else if (err.code === "DELETE_FAILED") toast.error(t("storefront.account.deleteFailed"));
        else toast.error(err.message || t("storefront.account.deleteFailed"));
      } else {
        toast.error(err instanceof Error ? err.message : t("storefront.account.deleteFailed"));
      }
      setBusy(false);
    }
  };

  return (
    <section className="card danger-card">
      <div className="danger-head">
        <h2>{t("storefront.account.deleteAccount")}</h2>
        <p className="sub">{t("storefront.account.deleteHint")}</p>
      </div>
      {!open ? (
        <div className="danger-actions">
          <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
            {t("storefront.account.deleteMyAccount")}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="danger-form">
          <div className="danger-warn">
            <Icon name="shield" size={18} />
            <div>
              <strong>{t("storefront.account.deleteWarning", { email: user?.email ?? "" })}</strong>
              <br />
              {t("storefront.account.deleteWarningSub")}
            </div>
          </div>
          <label>
            <span>{t("storefront.account.typeDeleteLabel")}</span>
            <input
              className="input"
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="DELETE"
              autoComplete="off"
              autoFocus
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
          <div className="danger-actions">
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={busy || confirm.trim() !== "DELETE" || !current}
            >
              {busy ? (
                <>
                  <Icon name="spinner" size={16} className="is-spinning" />
                  <span>{t("common.loading")}</span>
                </>
              ) : (
                <span>{t("storefront.account.permanentlyDelete")}</span>
              )}
            </button>
          </div>
        </form>
      )}
      <style>{`
        .danger-card { padding: 26px 28px; border-color: color-mix(in srgb, var(--price) 35%, var(--line)); }
        .danger-head h2 { font-size: 1.15rem; margin-bottom: 4px; color: var(--price); }
        .sub { color: var(--ink-soft); font-size: .86rem; margin-bottom: 18px; line-height: 1.5; }
        .danger-form { display: flex; flex-direction: column; gap: 14px; }
        .danger-warn { display: flex; gap: 12px; padding: 12px 14px; background: var(--price-soft); border-radius: var(--radius-sm); color: var(--ink); font-size: .85rem; line-height: 1.5; }
        .danger-warn svg { flex-shrink: 0; color: var(--price); margin-top: 2px; }
        .danger-warn code { background: var(--surface); padding: 1px 6px; border-radius: 4px; font-size: .78rem; }
        .ink-strong { color: var(--ink); font-weight: 600; }
        label { display: flex; flex-direction: column; gap: 6px; font-size: .8rem; font-weight: 600; color: var(--ink-soft); }
        label code { background: var(--surface-2); padding: 1px 6px; border-radius: 4px; font-size: .78rem; }
        .danger-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
        .btn-danger { background: var(--price); color: #fff; border-color: var(--price); }
        .btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--price) 85%, #000); }
        .btn-danger:disabled { opacity: .5; cursor: not-allowed; }
      `}</style>
    </section>
  );
};
