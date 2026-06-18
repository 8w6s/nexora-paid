import type React from "react";
import { useEffect, useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";

/**
 * Step 2 of the customer password-reset flow. The token comes from the
 * email link as `?token=...`. We validate its surface shape on mount so
 * a missing/malformed link surfaces immediately instead of waiting for a
 * submit; the backend re-validates the same shape + signature so this is
 * pure UX, not a security boundary.
 * On success, the backend mints a fresh session cookie (via the same
 * createSession path login uses) and we navigate to the My Orders page —
 * the redirect target most users came back here for.
 */
export const ResetPasswordForm: React.FC = () => {
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pull the token out of the URL on mount. We never put the token in
  // React state from props/SSR — the page renders client-only so the
  // token only ever lives in the URL bar of the browser that received it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!/^[0-9a-f]{64}$/i.test(raw)) {
      setTokenError(
        "This reset link is invalid or has been mangled. Request a new one from the Sign in page.",
      );
      return;
    }
    setToken(raw);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (!token) {
      setError("Missing token");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/reset", { token, password });
      // Backend has minted a session cookie. Land on My Orders — the page
      // most password-reset attempts are coming back to.
      window.location.assign("/orders");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "BAD_TOKEN") {
          setError(
            "This reset link has expired or already been used. Request a new one from the Sign in page.",
          );
        } else if (err.code === "RATE_LIMITED") {
          setError("Too many attempts. Wait a few minutes and try again.");
        } else {
          setError(err.message || "Reset failed. Try again.");
        }
      } else {
        setError(err instanceof Error ? err.message : "Reset failed. Try again.");
      }
      setBusy(false);
    }
  };

  return (
    <main className="container auth-page">
      <div className="auth-card card">
        <h1>Choose a new password</h1>
        {tokenError ? (
          <>
            <p className="sub">{tokenError}</p>
            <p className="switch">
              <a href="/forgot" style={{ color: "var(--brand)", fontWeight: 600 }}>
                Request a new reset link
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="sub">
              Pick a new password for your Nexora account. You'll be signed in automatically once
              it's set.
            </p>
            <form onSubmit={submit}>
              <label>
                <span>New password</span>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>Confirm password</span>
                <PasswordInput
                  value={confirm}
                  onChange={setConfirm}
                  required
                  minLength={8}
                  placeholder="Re-enter the password"
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
                    <span>Updating…</span>
                  </>
                ) : (
                  <span>Set new password</span>
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