import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { EmptyState } from "../EmptyState";

interface ApiKey {
  id: string;
  name: string;
  key: string; // masked: sk_live_****
  prefix: string;
  scopes: string[];
  lastUsed?: string;
  createdAt: string;
  active: boolean;
}

interface WebhookEvent {
  id: string;
  event: string;
  url: string;
  status: number;
  createdAt: string;
}

const ALL_SCOPES = [
  { key: "products:read", label: "Products Read" },
  { key: "products:write", label: "Products Write" },
  { key: "orders:read", label: "Orders Read" },
  { key: "orders:write", label: "Orders Write" },
  { key: "customers:read", label: "Customers Read" },
  { key: "coupons:read", label: "Coupons Read" },
  { key: "coupons:write", label: "Coupons Write" },
  { key: "settings:read", label: "Settings Read" },
];

type DeveloperTab = "api-keys" | "webhooks";

export const AdminDevelopers: React.FC = () => {
  const [tab, setTab] = useState<DeveloperTab>("api-keys");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhookLog, setWebhookLog] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["products:read", "orders:read"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<ApiKey[]>("/api/admin/api-keys").catch(() => [] as ApiKey[]),
      api.get<WebhookEvent[]>("/api/admin/webhook-logs").catch(() => [] as WebhookEvent[]),
    ]).then(([k, w]) => { setApiKeys(k); setWebhookLog(w); }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const createKey = async () => {
    if (!keyName.trim()) return setErr("Key name is required");
    setBusy(true); setErr(null);
    try {
      const result = await api.post<{ key: string }>("/api/admin/api-keys", { name: keyName.trim(), scopes });
      setNewKey(result.key);
      setKeyName(""); setScopes(["products:read", "orders:read"]); setCreating(false); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const revokeKey = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    await api.delete(`/api/admin/api-keys/${id}`).catch(() => {});
    load();
  };

  const toggleScope = (scope: string) => {
    setScopes(s => s.includes(scope) ? s.filter(x => x !== scope) : [...s, scope]);
  };

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Developers</h2>
          <p className="muted">Manage API keys and developer integrations.</p>
        </div>
      </div>

      <div className="pe-tabs" style={{ marginBottom: 0 }}>
        <button type="button" className={`pe-tab ${tab === "api-keys" ? "on" : ""}`} onClick={() => setTab("api-keys")}>
          <Icon name="key" size={14} /> API Keys
        </button>
        <button type="button" className={`pe-tab ${tab === "webhooks" ? "on" : ""}`} onClick={() => setTab("webhooks")}>
          <Icon name="zap" size={14} /> Webhook Logs
        </button>
      </div>

      {tab === "api-keys" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {newKey && (
            <div className="dev-new-key-banner">
              <Icon name="key" size={18} />
              <div style={{ flex: 1 }}>
                <strong>Your new API key — copy it now, it won't be shown again.</strong>
                <div className="dev-key-display">
                  <code>{newKey}</code>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyKey(newKey)}>
                    {copied ? <><Icon name="check" size={13} /> Copied!</> : <><Icon name="copy" size={13} /> Copy</>}
                  </button>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewKey(null)}><Icon name="close" size={13} /></button>
            </div>
          )}

          <div className="adm-sec-head" style={{ marginTop: 0 }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>API Keys</h3>
            <button className="btn btn-outline" onClick={() => { setCreating(true); setErr(null); }}>
              <Icon name="plus" size={14} /> Create Key
            </button>
          </div>

          {creating && (
            <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              {err && <div className="pe-err">{err}</div>}
              <label className="pe-field-label">Key Name
                <input className="input" value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="e.g. My Integration" onKeyDown={e => e.key === "Enter" && createKey()} />
              </label>
              <label className="pe-field-label">Permissions</label>
              <div className="dev-scopes">
                {ALL_SCOPES.map(s => (
                  <label key={s.key} className={`dev-scope ${scopes.includes(s.key) ? "on" : ""}`}>
                    <input type="checkbox" checked={scopes.includes(s.key)} onChange={() => toggleScope(s.key)} style={{ display: "none" }} />
                    {scopes.includes(s.key) ? <Icon name="check" size={12} /> : <span className="dev-scope-dot" />}
                    {s.label}
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
                <button className="btn" onClick={createKey} disabled={busy || scopes.length === 0}>
                  {busy ? <><Icon name="spinner" size={14} className="is-spinning" /> Creating…</> : "Create Key"}
                </button>
              </div>
            </div>
          )}

          {loading ? <div className="adm-loading"><Icon name="spinner" size={24} className="is-spinning" /></div>
            : apiKeys.length === 0
              ? <EmptyState icon="key" title="No API Keys" message="Create an API key to access the Nexora API." action={{ label: "Create Key", onClick: () => setCreating(true) }} />
              : (
                <div className="card" style={{ overflow: "hidden" }}>
                  <table className="adm-table">
                    <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last Used</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {apiKeys.map(k => (
                        <tr key={k.id}>
                          <td><strong>{k.name}</strong></td>
                          <td><code style={{ fontSize: ".82rem" }}>{k.key}</code></td>
                          <td>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {k.scopes.slice(0, 2).map(s => <span key={s} className="badge badge-gray" style={{ fontSize: ".7rem" }}>{s}</span>)}
                              {k.scopes.length > 2 && <span className="badge badge-gray" style={{ fontSize: ".7rem" }}>+{k.scopes.length - 2}</span>}
                            </div>
                          </td>
                          <td>{k.lastUsed ? new Date(k.lastUsed).toLocaleDateString() : "Never"}</td>
                          <td><span className={`badge ${k.active ? "badge-green" : "badge-gray"}`}>{k.active ? "Active" : "Revoked"}</span></td>
                          <td>
                            {k.active && <button className="btn btn-ghost btn-sm btn-danger-icon" onClick={() => revokeKey(k.id)} title="Revoke key"><Icon name="close" size={13} /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
      )}

      {tab === "webhooks" && (
        <div>
          {loading ? <div className="adm-loading"><Icon name="spinner" size={24} className="is-spinning" /></div>
            : webhookLog.length === 0
              ? <EmptyState icon="zap" title="No Webhook Events" message="Webhook delivery attempts will appear here." />
              : (
                <div className="card" style={{ overflow: "hidden" }}>
                  <table className="adm-table">
                    <thead><tr><th>Event</th><th>URL</th><th>Status</th><th>Date</th></tr></thead>
                    <tbody>
                      {webhookLog.map(w => (
                        <tr key={w.id}>
                          <td><code style={{ fontSize: ".82rem" }}>{w.event}</code></td>
                          <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.url}</td>
                          <td><span className={`badge ${w.status >= 200 && w.status < 300 ? "badge-green" : "badge-red"}`}>{w.status}</span></td>
                          <td>{new Date(w.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
      )}

      <style>{`
        .dev-new-key-banner { display: flex; align-items: flex-start; gap: 14px; padding: 18px 20px; background: rgba(34,197,94,.08); border: 1.5px solid rgba(34,197,94,.25); border-radius: var(--radius); }
        .dev-key-display { display: flex; align-items: center; gap: 10px; margin-top: 8px; padding: 10px 14px; background: var(--surface-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); }
        .dev-key-display code { flex: 1; font-size: .85rem; word-break: break-all; color: var(--ink); }
        .dev-scopes { display: flex; flex-wrap: wrap; gap: 8px; }
        .dev-scope { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1.5px solid var(--line-strong); border-radius: var(--radius-sm); cursor: pointer; font-size: .82rem; font-weight: 600; background: var(--surface-2); transition: all .15s; }
        .dev-scope.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
        .dev-scope-dot { width: 10px; height: 10px; border: 1.5px solid var(--line-strong); border-radius: 2px; display: block; }
      `}</style>
    </div>
  );
};
