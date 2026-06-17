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
