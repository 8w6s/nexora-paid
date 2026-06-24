import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";

type TeamRole = "admin" | "manager" | "support" | "viewer";

interface TeamMember {
  id: string;
  email: string;
  role: TeamRole;
  name?: string;
  joinedAt: string;
  status: "active" | "pending";
}

const ROLES: { key: TeamRole; label: string; description: string }[] = [
  { key: "admin", label: "Admin", description: "Full access to all settings and data." },
  { key: "manager", label: "Manager", description: "Can manage products, orders, and customers." },
  { key: "support", label: "Support", description: "Can view orders and manage support tickets." },
  { key: "viewer", label: "Viewer", description: "Read-only access to dashboard." },
];

const ROLE_COLORS: Record<TeamRole, string> = {
  admin: "badge-red",
  manager: "badge-blue",
  support: "badge-green",
  viewer: "badge-gray",
};

interface AdminSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  // Migration 0007 surfaces these. NULL on pre-migration rows; the UI
  // shows "Unknown" in that case rather than dropping the row.
  ipAddress: string | null;
  lastIp: string | null;
  userAgent: string | null;
  current: boolean;
}

/**
 * Squeeze a User-Agent string down to "<Browser> · <OS>" for the table
 * cell. Real UAs are long and noisy ("Mozilla/5.0 (Windows NT 10.0;
 * Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0
 * Safari/537.36"); we want at-a-glance "Chrome · Windows" which is
 * what Sellauth and Whop show.
 */
function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  // Order matters: Edg, OPR, and Firefox UAs all also contain "Chrome",
  // so check the derivative-browser tokens first and only fall through
  // to Chrome / Safari for the base case.
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("OPR/")
      ? "Opera"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Chrome/")
          ? "Chrome"
          : ua.includes("Safari/")
            ? "Safari"
            : "Browser";
  const os = ua.includes("Windows NT")
    ? "Windows"
    : ua.includes("Mac OS X")
      ? "macOS"
      : ua.includes("Android")
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : ua.includes("Linux")
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Active-sessions card. Lists every live session for the actor with a
 * one-click "log out everywhere else" so a stolen cookie can be evicted
 * without rotating the password. Pairs with AdminAccountCard for the
 * SOC2/ISO 27001 baseline most enterprise self-host buyers expect.
 */
const AdminSessionsCard: React.FC = () => {
  const [list, setList] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<{ sessions: AdminSession[] }>("/api/admin/account/sessions")
      .then((r) => setList(r?.sessions ?? []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const revokeOthers = async () => {
    if (!confirm("Log out every other device for your account?")) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/admin/account/sessions/revoke-others",
        {},
      );
      const n = res?.revokedSessions ?? 0;
      setOkMsg(
        n > 0 ? `Revoked ${n} other session${n === 1 ? "" : "s"}.` : "No other sessions to revoke.",
      );
      load();
    } catch {
      setOkMsg("Failed to revoke sessions.");
    } finally {
      setBusy(false);
    }
  };

  const revokeOne = async (id: string) => {
    if (!confirm("Revoke this session? The device will be logged out immediately.")) {
      return;
    }
    try {
      await api.post(`/api/admin/account/sessions/${id}/revoke`, {});
      setOkMsg("Session revoked.");
      load();
    } catch (e) {
      setOkMsg(e instanceof Error ? e.message : "Failed to revoke session.");
    }
  };

  const others = list.filter((s) => !s.current).length;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: ".95rem" }}>Active sessions</div>
          <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
            Devices currently logged in to your account.
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={revokeOthers}
          disabled={busy || others === 0}
        >
          {busy ? (
            <>
              <Icon name="spinner" size={14} className="is-spinning" /> Revoking…
            </>
          ) : (
            <>
              <Icon name="close" size={14} /> Log out other devices
            </>
          )}
        </button>
      </div>
      {okMsg && (
        <div className="team-success" style={{ marginBottom: 12 }}>
          <Icon name="check" size={15} />
          <span>{okMsg}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOkMsg(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={20} className="is-spinning" />
        </div>
      ) : list.length === 0 ? (
        <div className="muted" style={{ fontSize: ".85rem" }}>
          No active sessions.
        </div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Device</th>
              <th>IP</th>
              <th>Started</th>
              <th>Last seen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <code style={{ fontSize: ".78rem" }}>{s.id}…</code>
                  {s.current && (
                    <span
                      className="badge badge-green"
                      style={{ marginLeft: 8, fontSize: ".7rem" }}
                    >
                      this device
                    </span>
                  )}
                </td>
                <td title={s.userAgent ?? ""} style={{ fontSize: ".82rem" }}>
                  {summarizeUserAgent(s.userAgent)}
                </td>
                <td style={{ fontSize: ".82rem" }}>
                  <code>{s.lastIp ?? s.ipAddress ?? "Unknown"}</code>
                  {s.lastIp && s.ipAddress && s.lastIp !== s.ipAddress && (
                    <div className="muted" style={{ fontSize: ".72rem", marginTop: 2 }}>
                      started: <code>{s.ipAddress}</code>
                    </div>
                  )}
                </td>
                <td style={{ fontSize: ".82rem" }}>{new Date(s.createdAt).toLocaleString()}</td>
                <td style={{ fontSize: ".82rem" }}>{new Date(s.lastSeenAt).toLocaleString()}</td>
                <td style={{ textAlign: "right" }}>
                  {!s.current && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger-icon"
                      title="Revoke this session"
                      onClick={() => revokeOne(s.id)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/**
 * Self-service password rotation card. Lives on the Team tab so an admin
 * who lands here to manage access also sees their own credential controls
 * in the same place — same SOC2 / ISO 27001 baseline most enterprise
 * self-host buyers expect.
 *
 * Hits POST /api/admin/account/password which:
 *   - verifies the supplied current password against the stored argon2id hash,
 *   - rotates the hash,
 *   - revokes every OTHER session for this admin so a stolen cookie minted
 *     before the rotation cannot outlive the change,
 *   - audit-logs the rotation (or the failure) under account.password.{rotate,fail}.
 *
 * The actor's current session survives so they aren't logged out mid-flow.
 */
const AdminAccountCard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setOkMsg(null);
    if (next.length < 12) {
      setErr("New password must be at least 12 characters.");
      return;
    }
    if (next !== confirm) {
      setErr("New password confirmation does not match.");
      return;
    }
    if (next === cur) {
      setErr("New password must differ from current.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/admin/account/password",
        { currentPassword: cur, newPassword: next },
      );
      const revoked = res?.revokedSessions ?? 0;
      setOkMsg(
        revoked > 0
          ? `Password rotated. Revoked ${revoked} other session${revoked === 1 ? "" : "s"}.`
          : "Password rotated.",
      );
      setCur("");
      setNext("");
      setConfirm("");
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to rotate password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: ".95rem" }}>Your password</div>
          <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
            Rotate your admin password. All other sessions for your account will be revoked.
          </div>
        </div>
        {!open && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setOpen(true);
              setErr(null);
              setOkMsg(null);
            }}
          >
            <Icon name="key" size={14} /> Change password
          </button>
        )}
      </div>

      {okMsg && (
        <div className="team-success" style={{ marginTop: 14 }}>
          <Icon name="check" size={15} />
          <span>{okMsg}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOkMsg(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          {err && <div className="pe-err">{err}</div>}
          <label className="pe-field-label">
            Current password
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
          </label>
          <label className="pe-field-label">
            New password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <span className="muted" style={{ fontSize: ".75rem" }}>
              At least 12 characters.
            </span>
          </label>
          <label className="pe-field-label">
            Confirm new password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setCur("");
                setNext("");
                setConfirm("");
                setErr(null);
              }}
            >
              Cancel
            </button>
            <button
              className="btn"
              type="button"
              onClick={submit}
              disabled={busy || !cur || !next || !confirm}
            >
              {busy ? (
                <>
                  <Icon name="spinner" size={14} className="is-spinning" /> Rotating…
                </>
              ) : (
                "Rotate password"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const AdminTeam: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("support");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<TeamMember[]>("/api/admin/team")
      .catch(() => [] as TeamMember[])
      .then(setMembers)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const invite = async () => {
    if (!email.trim()) return setErr("Email is required");
    setBusy(true);
    setErr(null);
    setSuccess(null);
    try {
      await api.post("/api/admin/team/invite", { email: email.trim(), role });
      setSuccess(`Invitation sent to ${email.trim()}`);
      setEmail("");
      setInviting(false);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to send invitation");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, memberEmail: string) => {
    if (!confirm(`Remove ${memberEmail} from your team?`)) return;
    await api.del(`/api/admin/team/${id}`).catch(() => {});
    load();
  };

  const updateRole = async (id: string, newRole: TeamRole) => {
    await api.patch(`/api/admin/team/${id}`, { role: newRole }).catch(() => {});
    load();
  };

  return (
    <div className="adm-section">
      <AdminAccountCard />
      <AdminSessionsCard />
      <div className="adm-sec-head">
        <div>
          <h2>Team</h2>
          <p className="muted">Manage access to your admin panel.</p>
        </div>
        <button
          className="btn"
          onClick={() => {
            setInviting(true);
            setErr(null);
            setSuccess(null);
          }}
        >
          <Icon name="plus" size={14} /> Invite Member
        </button>
      </div>

      {success && (
        <div className="team-success">
          <Icon name="check" size={15} />
          <span>{success}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSuccess(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {inviting && (
        <div
          className="card"
          style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div className="adm-section-label">Invite a Team Member</div>
          {err && <div className="pe-err">{err}</div>}
          <label className="pe-field-label">
            Email Address
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              onKeyDown={(e) => e.key === "Enter" && invite()}
            />
          </label>
          <label className="pe-field-label">Role</label>
          <div className="team-roles">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`team-role-card ${role === r.key ? "on" : ""}`}
                onClick={() => setRole(r.key)}
              >
                <strong>{r.label}</strong>
                <span>{r.description}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setInviting(false)}>
              Cancel
            </button>
            <button className="btn" onClick={invite} disabled={busy}>
              {busy ? (
                <>
                  <Icon name="spinner" size={14} className="is-spinning" /> Sending…
                </>
              ) : (
                "Send Invitation"
              )}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={24} className="is-spinning" />
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon="users"
          title="No Team Members"
          message="Invite colleagues to help manage your store."
          action={{ label: "Invite Member", onClick: () => setInviting(true) }}
        />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="team-avatar">{(m.name ?? m.email)[0].toUpperCase()}</span>
                      <div>
                        {m.name && <div style={{ fontWeight: 600 }}>{m.name}</div>}
                        <div style={{ fontSize: ".82rem", color: "var(--ink-soft)" }}>
                          {m.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      className="input"
                      style={{ padding: "4px 8px", width: "auto", fontSize: ".82rem" }}
                      value={m.role}
                      onChange={(e) => updateRole(m.id, e.target.value as TeamRole)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span
                      className={`badge ${m.status === "active" ? "badge-green" : "badge-yellow"}`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td>{new Date(m.joinedAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm btn-danger-icon"
                      onClick={() => remove(m.id, m.email)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .team-success { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.25); border-radius: var(--radius); font-size: .88rem; font-weight: 600; color: #15803d; }
        .team-success { gap: 10px; flex: 1; }
        .team-roles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .team-role-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; text-align: left; background: var(--surface-2); transition: all .15s; font-family: var(--font-sans); }
        .team-role-card strong { font-size: .9rem; color: var(--ink); }
        .team-role-card span { font-size: .78rem; color: var(--ink-soft); }
        .team-role-card:hover { border-color: var(--brand); }
        .team-role-card.on { border-color: var(--brand); background: var(--brand-soft); }
        .team-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .85rem; flex-shrink: 0; }
        @media (max-width: 640px) { .team-roles { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};
