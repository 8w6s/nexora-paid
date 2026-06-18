import type React from "react";
import { useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./Toast";

/**
 * Self-service email-on-record change. Sellauth's profile General form
 * has the same field; without it a customer who typoed at register
 * (or whose provider went away) is locked out of /orders forever.
 *
 * Backend gates the change on currentPassword so a stolen cookie alone
 * can't rotate the email — that would let an attacker use the password-
 * reset flow against the new address to fully take over the account.
 * On success the backend revokes other sessions and best-effort notifies
 * the OLD address so a legitimate owner who didn't request it has a
 * recovery trail.
 */
export const AccountEmailCard: React.FC = () => {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    if (trimmed === user?.email) {
      toast.error("New email must differ from current");
      return;
    }
    if (!current) {
      toast.error("Current password is required");
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
          ? `Email updated to ${res.email}. Signed out of ${revoked} other device${revoked === 1 ? "" : "s"}.`
          : `Email updated to ${res.email}.`,
      );
      setNewEmail("");
      setCurrent("");
      // Pull fresh /me so the navbar dropdown + AccountInner header
      // reflect the new address without a hard reload.
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_CURRENT") toast.error("Current password is incorrect");
        else if (err.code === "EMAIL_TAKEN") toast.error("That email is already in use");
        else if (err.code === "SAME_EMAIL") toast.error("New email must differ from current");
        else if (err.code === "RATE_LIMITED") toast.error("Too many attempts. Wait a few minutes.");
        else toast.error(err.message || "Could not update email");
      } else {
        toast.error(err instanceof Error ? err.message : "Could not update email");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card acct-card">
      <div className="acct-head">
        <h2>Change email</h2>
        <p className="sub">
          Update the email address used to sign in and receive order receipts. Other devices will be
          signed out and the old address gets a notification.
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Current email</span>
          <input
            className="input"
            type="email"
            value={user?.email ?? ""}
            disabled
            readOnly
          />
        </label>
        <label>
          <span>New email</span>
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
          <span>Current password</span>
          <PasswordInput
            value={current}
            onChange={setCurrent}
            required
            placeholder="To confirm it's really you"
            autoComplete="current-password"
          />
        </label>
        <div className="acct-actions">
          <button
            className="btn"
            type="submit"
            disabled={busy || !newEmail.trim() || !current}
          >
            {busy ? (
              <>
                <Icon name="spinner" size={16} className="is-spinning" />
                <span>Updating…</span>
              </>
            ) : (
              <span>Update email</span>
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