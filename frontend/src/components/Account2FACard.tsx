import type React from "react";
import { useEffect, useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

interface SetupResponse {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

/**
 * Customer-facing 2FA enrollment card on /account.
 *
 * Three states:
 *  - Disabled  : "Enable 2FA" button -> flips to setup state
 *  - Setup     : QR + secret + backup codes (shown ONCE) + verify input
 *  - Enabled   : "Disable 2FA" button -> prompts for current TOTP code
 *
 * QR rendered via api.qrserver.com (the same public service the
 * Litecoin checkout already uses for payment QRs — no extra deps).
 */
export const Account2FACard: React.FC = () => {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // Distinct loading vs hidden states. The endpoint 403s for admins and the
  // generic catch used to leave `enabled === null` forever, frezing the card
  // on "Loading…". `loadFailed` flips when the fetch settles with a non-OK
  // response so the card can hide itself instead of looking broken.
  const [loadFailed, setLoadFailed] = useState(false);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [disablePrompt, setDisablePrompt] = useState(false);

  // Load current 2FA status on mount. /api/auth/2fa/status is gated to
  // customers — admins hit a 403 and the card hides itself via the
  // catch -> null path.
  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/auth/2fa/status")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setLoadFailed(true));
  }, []);

  const beginSetup = async () => {
    setBusy(true);
    try {
      const res = await api.get<SetupResponse>("/api/auth/2fa/setup");
      setSetup(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start 2FA setup");
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setSetup(null);
    setCode("");
  };

  const submitEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/auth/2fa/enable",
        { code },
      );
      const revoked = res.revokedSessions ?? 0;
      toast.success(
        revoked > 0
          ? `2FA enabled. Signed out of ${revoked} other device${revoked === 1 ? "" : "s"}.`
          : "2FA enabled.",
      );
      setEnabled(true);
      setSetup(null);
      setCode("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "INVALID_CODE") toast.error("Invalid code — check your authenticator app");
        else if (err.code === "RATE_LIMITED") toast.error("Too many attempts. Wait a few minutes.");
        else if (err.code === "NO_CANDIDATE") {
          toast.error("Setup expired — start again");
          setSetup(null);
        } else toast.error(err.message || "Could not enable 2FA");
      } else {
        toast.error(err instanceof Error ? err.message : "Could not enable 2FA");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/auth/2fa/disable",
        { code },
      );
      const revoked = res.revokedSessions ?? 0;
      toast.success(
        revoked > 0
          ? `2FA disabled. Signed out of ${revoked} other device${revoked === 1 ? "" : "s"}.`
          : "2FA disabled.",
      );
      setEnabled(false);
      setDisablePrompt(false);
      setCode("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "INVALID_CODE") toast.error("Invalid code");
        else if (err.code === "RATE_LIMITED") toast.error("Too many attempts. Wait a few minutes.");
        else toast.error(err.message || "Could not disable 2FA");
      } else {
        toast.error(err instanceof Error ? err.message : "Could not disable 2FA");
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  // Status fetch failed (e.g. admin role gets 403). The card is customer-only —
  // hide it rather than freezing on "Loading…" forever.
  if (loadFailed) return null;

  // Loading state — render the same shell so the page doesn't jitter.
  if (enabled === null) {
    return (
      <section className="card acct-card">
        <div className="acct-head">
          <h2>Two-factor authentication</h2>
          <p className="sub muted">Loading…</p>
        </div>
      </section>
    );
  }

  // Backup codes joined for clipboard. Keep the separator as a single
  // space so a multi-line literal isn't needed — the user's clipboard
  // contains all eight codes on one line, easy to paste into a notes
  // app and reflow as wanted.
  const backupAllString = setup?.backupCodes?.join(" ") ?? "";

  return (
    <section className="card acct-card">
      <div className="acct-head">
        <h2>Two-factor authentication</h2>
        <p className="sub">
          {enabled
            ? "2FA is enabled. You'll need a code from your authenticator app every time you sign in."
            : "Add a second step to sign-in by linking an authenticator app like Google Authenticator, Authy, or 1Password."}
        </p>
      </div>

      {/* Disabled — entry point */}
      {!enabled && !setup && (
        <div className="acct-actions">
          <button type="button" className="btn" onClick={beginSetup} disabled={busy}>
            {busy ? (
              <>
                <Icon name="spinner" size={16} className="is-spinning" />
                <span>Loading…</span>
              </>
            ) : (
              <>
                <Icon name="shield" size={16} />
                <span>Enable 2FA</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Disabled — setup in progress */}
      {!enabled && setup && (
        <form onSubmit={submitEnable} className="setup-form">
          <div className="setup-step">
            <div className="step-num">1</div>
            <div className="step-body">
              <strong>Scan this QR code in your authenticator app.</strong>
              <p className="muted small">
                Or enter the secret manually:
                <code className="secret">{setup.secret}</code>
                <button type="button" className="btn-link" onClick={() => copy(setup.secret, "Secret")}>
                  Copy
                </button>
              </p>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setup.otpauthUrl)}`}
                alt="2FA QR code"
                className="qr"
              />
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">2</div>
            <div className="step-body">
              <strong>Save these backup codes.</strong>
              <p className="muted small">
                Each code works once if you lose your authenticator app. They will NOT be shown
                again.
              </p>
              <div className="backup-grid">
                {setup.backupCodes.map((c) => (
                  <code key={c} className="backup-code">
                    {c}
                  </code>
                ))}
              </div>
              <button
                type="button"
                className="btn-link"
                onClick={() => copy(backupAllString, "Backup codes")}
              >
                Copy all
              </button>
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">3</div>
            <div className="step-body">
              <strong>Enter the 6-digit code from your app to confirm.</strong>
              <input
                className="input code-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
          </div>

          <div className="acct-actions">
            <button type="button" className="btn btn-ghost" onClick={cancelSetup} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={busy || code.length !== 6}>
              {busy ? (
                <>
                  <Icon name="spinner" size={16} className="is-spinning" />
                  <span>Verifying…</span>
                </>
              ) : (
                <span>Verify & enable</span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Enabled — disable surface */}
      {enabled && !disablePrompt && (
        <div className="acct-actions">
          <span className="enabled-badge">
            <Icon name="check" size={14} />
            <span>2FA is on</span>
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setDisablePrompt(true)}>
            Disable 2FA
          </button>
        </div>
      )}

      {enabled && disablePrompt && (
        <form onSubmit={submitDisable} className="disable-form">
          <label>
            <span>Enter the 6-digit code from your authenticator to confirm</span>
            <input
              className="input code-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              autoFocus
            />
          </label>
          <div className="acct-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDisablePrompt(false);
                setCode("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="btn" disabled={busy || code.length !== 6}>
              {busy ? (
                <>
                  <Icon name="spinner" size={16} className="is-spinning" />
                  <span>Disabling…</span>
                </>
              ) : (
                <span>Confirm disable</span>
              )}
            </button>
          </div>
        </form>
      )}

      <style>{`
        .acct-card { padding: 26px 28px; }
        .acct-head h2 { font-size: 1.15rem; margin-bottom: 4px; }
        .sub { color: var(--ink-soft); font-size: .86rem; line-height: 1.5; margin-bottom: 18px; }
        .acct-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 8px; }
        .enabled-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: color-mix(in srgb, #16a34a 15%, var(--surface)); color: #16a34a; border-radius: 100px; font-weight: 600; font-size: .82rem; margin-right: auto; }
        .setup-form { display: flex; flex-direction: column; gap: 18px; padding: 16px; background: var(--surface-2); border-radius: var(--radius-sm); }
        .setup-step { display: flex; gap: 14px; }
        .step-num { flex-shrink: 0; width: 28px; height: 28px; border-radius: 100px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .9rem; }
        .step-body { flex: 1; min-width: 0; }
        .step-body strong { display: block; margin-bottom: 6px; font-size: .92rem; }
        .step-body .small { font-size: .8rem; }
        .step-body .secret { display: inline-block; margin: 0 6px; padding: 2px 8px; background: var(--surface); border-radius: 4px; font-family: monospace; font-size: .82rem; user-select: all; }
        .qr { display: block; width: 200px; height: 200px; border-radius: var(--radius-sm); background: #fff; padding: 8px; margin-top: 10px; }
        .backup-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
        .backup-code { padding: 6px 8px; background: var(--surface); border-radius: 4px; font-family: monospace; font-size: .85rem; text-align: center; user-select: all; }
        .code-input { font-family: monospace; font-size: 1.1rem; letter-spacing: .15em; text-align: center; max-width: 160px; margin-top: 8px; }
        .disable-form { display: flex; flex-direction: column; gap: 14px; }
        .disable-form label { display: flex; flex-direction: column; gap: 4px; font-size: .82rem; font-weight: 600; color: var(--ink-soft); }
        .muted { color: var(--ink-soft); }
        .btn-link { background: none; border: none; color: var(--brand); cursor: pointer; font-weight: 600; font-size: .8rem; padding: 0 4px; }
        .btn-link:hover { text-decoration: underline; }
      `}</style>
    </section>
  );
};