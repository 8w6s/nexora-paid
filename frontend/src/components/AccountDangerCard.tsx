import type React from "react";
import { useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./Toast";

/**
 * GDPR Article 17 right-to-erasure surface. Soft-deletes via the
 * /api/auth/delete-account backend route — orders survive (operator
 * needs them for tax records) but the users row is anonymized so
 * the customer's PII is gone from the live system.
 *
 * Defense-in-depth against accidental clicks:
 *  - Card collapsed by default; user must click "Delete account" once
 *    to expand the actual form.
 *  - Confirmation field requires typing the literal word DELETE so a
 *    mistyped current-password and an autofilled email can't combine
 *    into a one-click erasure.
 *  - Current password required so a stolen cookie alone can't trigger
 *    the deletion (which would lock out the legitimate owner).
 */
export const AccountDangerCard: React.FC = () => {
  const { user } = useAuth();
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
      toast.error('Type DELETE to confirm');
      return;
    }
    if (!current) {
      toast.error("Current password is required");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/delete-account", { currentPassword: current });
      // Backend has cleared the cookie. Land on homepage with a
      // goodbye toast — going to /login would feel hostile after
      // the user just intentionally walked away.
      toast.success("Account deleted. Goodbye!");
      window.setTimeout(() => window.location.assign("/"), 1200);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_CURRENT") toast.error("Current password is incorrect");
        else if (err.code === "DELETE_FAILED") toast.error("Could not delete account, try again");
        else toast.error(err.message || "Could not delete account");
      } else {
        toast.error(err instanceof Error ? err.message : "Could not delete account");
      }
      setBusy(false);
    }
  };

  return (
    <section className="card danger-card">
      <div className="danger-head">
        <h2>Delete account</h2>
        <p className="sub">
          Permanently anonymise your account. Your order history is preserved (the operator
          needs it for tax records) but your email address, password, and 2FA are wiped from
          the live system. This action cannot be undone.
        </p>
      </div>
      {!open ? (
        <div className="danger-actions">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setOpen(true)}
          >
            Delete my account
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="danger-form">
          <div className="danger-warn">
            <Icon name="shield" size={18} />
            <div>
              <strong>You're about to delete <span className="ink-strong">{user?.email}</span>.</strong>
              <br />
              You will not be able to sign in again. Type <code>DELETE</code> below and enter
              your current password to proceed.
            </div>
          </div>
          <label>
            <span>
              Type <code>DELETE</code> to confirm
            </span>
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
            <span>Current password</span>
            <PasswordInput
              value={current}
              onChange={setCurrent}
              required
              placeholder="To confirm it's really you"
              autoComplete="current-password"
            />
          </label>
          <div className="danger-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={reset}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={busy || confirm.trim() !== "DELETE" || !current}
            >
              {busy ? (
                <>
                  <Icon name="spinner" size={16} className="is-spinning" />
                  <span>Deleting…</span>
                </>
              ) : (
                <span>Permanently delete</span>
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