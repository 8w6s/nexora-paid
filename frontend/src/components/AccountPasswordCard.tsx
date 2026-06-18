import type React from "react";
import { useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./Toast";

/**
 * Self-service password rotation card for the customer /account page.
 * Mirrors Sellauth's profile form ("Current / New / Confirm") and the
 * AdminTeam admin rotation card on the admin side. After a successful
 * rotation the backend revokes every other session; we surface that
 * count in the toast so the user knows their other devices were
 * signed out.
 */
export const AccountPasswordCard: React.FC = () => {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      toast.error("New passwords don't match");
      return;
    }
    if (next === current) {
      toast.error("New password must differ from your current password");
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
          ? `Password updated. Signed out of ${revoked} other device${revoked === 1 ? "" : "s"}.`
          : "Password updated.",
      );
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_CURRENT") {
          toast.error("Current password is incorrect");
        } else if (err.code === "SAME_PASSWORD") {
          toast.error("New password must differ from current password");
        } else if (err.code === "RATE_LIMITED") {
          toast.error("Too many attempts. Wait a few minutes and try again.");
        } else {
          toast.error(err.message || "Could not update password");
        }
      } else {
        toast.error(err instanceof Error ? err.message : "Could not update password");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card acct-card">
      <div className="acct-head">
        <h2>Change password</h2>
        <p className="sub">
          Chose a new password. Every other device you're signed in on will be signed out.
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Current password</span>
          <PasswordInput
            value={current}
            onChange={setCurrent}
            required
            placeholder="Your current password"
            autoComplete="current-password"
          />
        </label>
        <label>
          <span>New password</span>
          <PasswordInput
            value={next}
            onChange={setNext}
            required
            minLength={8}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </label>
        <label>
          <span>Confirm new password</span>
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            required
            minLength={8}
            placeholder="Re-enter the new password"
            autoComplete="new-password"
          />
        </label>
        <div className="acct-actions">
          <button
            className="btn"
            type="submit"
            disabled={busy || !current || !next || !confirm}
          >
            {busy ? (
              <>
                <Icon name="spinner" size={16} className="is-spinning" />
                <span>Updating…</span>
              </>
            ) : (
              <span>Update password</span>
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