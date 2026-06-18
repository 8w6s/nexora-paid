import type React from "react";
import { useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";

/**
 * Step 1 of the customer password-reset flow. The backend always returns
 * ok=true (anti-enumeration: same response regardless of whether the email
 * exists), so the success message here is intentionally generic — "if an
 * account exists, an email has been sent". A real registered customer
 * receives a link; an attacker probing emails sees the same UI and learns
 * nothing.
 */
export const ForgotPasswordForm: React.FC = () => {
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
        setError("Too many attempts. Try again in a few minutes.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container auth-page">
      <div className="auth-card card">
        <h1>Reset your password</h1>
        {sent ? (
          // Anti-enumeration message: identical for "email exists" and
          // "email is unknown". Don't change this without revisiting the
          // /forgot backend's always-ok response shape.
          <>
            <p className="sub">
              If an account exists for <strong>{email}</strong>, we've sent a reset link. Check your
              inbox — the link is single-use and expires in 60 minutes.
            </p>
            <p className="switch">
              <a href="/login" style={{ color: "var(--brand)", fontWeight: 600 }}>
                ← Back to sign in
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="sub">
              Enter the email associated with your account and we'll send you a reset link.
            </p>
            <form onSubmit={submit}>
              <label>
                <span>Email</span>
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
                    <span>Sending…</span>
                  </>
                ) : (
                  <span>Send reset link</span>
                )}
              </button>
            </form>
            <p className="switch">
              Remembered it?{" "}
              <a href="/login" style={{ color: "var(--brand)", fontWeight: 600 }}>
                Sign in
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