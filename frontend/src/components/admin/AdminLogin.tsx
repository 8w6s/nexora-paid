import type React from "react";
import { useState } from "react";
import { useAuth } from "../AuthContext";
import { Icon } from "../Icon";
import { PasswordInput } from "../PasswordInput";

export const AdminLogin: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="card" onSubmit={submit}>
        <h1>Admin sign in</h1>
        <p className="sub">Restricted area — staff only.</p>
        <label>
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Password</span>
          <PasswordInput
            value={password}
            onChange={setPassword}
            required
            placeholder="Password"
            autoComplete="current-password"
          />
        </label>
        {error && <div className="err">{error}</div>}
        <button className="btn" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? (
            <>
              <Icon name="spinner" size={16} className="is-spinning" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
      <style>{`
        .admin-login { min-height: 80vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .admin-login .card { width: 100%; max-width: 360px; padding: 28px; display: flex; flex-direction: column; gap: 14px; }
        .admin-login h1 { font-size: 1.4rem; }
        .admin-login .sub { color: var(--ink-soft); font-size: .86rem; margin-top: -8px; }
        .admin-login label { display: flex; flex-direction: column; gap: 6px; font-size: .82rem; font-weight: 600; color: var(--ink-soft); }
        .admin-login .err { background: var(--price-soft); color: var(--price); padding: 9px 12px; border-radius: var(--radius-sm); font-size: .84rem; }
      `}</style>
    </div>
  );
};
