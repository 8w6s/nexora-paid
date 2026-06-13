import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { EmptyState } from "../EmptyState";

type Platform = "billgang" | "komerza" | "sellapp" | "sellhub" | "sellpass" | "shoppex";

interface ImportJob {
  id: string;
  platform: Platform;
  status: "pending" | "running" | "done" | "error";
  imported: number;
  total: number;
  createdAt: string;
  error?: string;
  importProducts: boolean;
  importFeedbacks: boolean;
  importGroups: boolean;
  importCategories: boolean;
}

const PLATFORMS: { key: Platform; label: string; types: string[] }[] = [
  { key: "billgang", label: "Billgang", types: ["Products", "Feedbacks"] },
  { key: "komerza", label: "Komerza", types: ["Products", "Feedbacks"] },
  { key: "sellapp", label: "SellApp", types: ["Products", "Feedbacks"] },
  { key: "sellhub", label: "SellHub", types: ["Products", "Feedbacks"] },
  { key: "sellpass", label: "Sellpass", types: ["Products", "Feedbacks"] },
  { key: "shoppex", label: "Shoppex", types: ["Products", "Groups", "Categories", "Feedbacks"] },
];

export const AdminImport: React.FC = () => {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Platform | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [options, setOptions] = useState({ products: true, feedbacks: true, groups: false, categories: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<ImportJob[]>("/api/admin/import/jobs").catch(() => [] as ImportJob[]).then(setJobs).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const startImport = async () => {
    if (!selected) return setErr("Select a platform");
    if (!apiKey.trim()) return setErr("API key is required");
    setBusy(true); setErr(null);
    try {
      await api.post("/api/admin/import", { platform: selected, apiKey, ...options });
      setSelected(null); setApiKey(""); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(false); }
  };

  const platform = PLATFORMS.find(p => p.key === selected);

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Import</h2>
          <p className="muted">Import your store data from another platform.</p>
        </div>
      </div>

      <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="adm-section-label">Select a Platform</div>
        <p className="pe-field-sub">Choose the platform you want to import your store data from.</p>

        <div className="import-platform-grid">
          {PLATFORMS.map(p => (
            <button
              key={p.key}
              type="button"
              className={`import-platform-card ${selected === p.key ? "on" : ""}`}
              onClick={() => { setSelected(p.key); setOptions({ products: true, feedbacks: true, groups: p.types.includes("Groups"), categories: p.types.includes("Categories") }); setErr(null); }}
            >
              <strong>{p.label}</strong>
              <div className="import-types">
                {p.types.map(t => <span key={t} className="badge badge-gray">{t}</span>)}
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: "1px solid var(--line)", paddingTop: 20 }}>
            <div className="adm-section-label">Configure Import</div>

            {err && <div className="pe-err">{err}</div>}

            <label className="pe-field-label">{platform?.label} API Key
              <input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste your API key here" />
            </label>

            <div className="adm-section-label" style={{ marginTop: 4 }}>What to Import</div>
            <div className="import-options">
              {[
                { key: "products" as const, label: "Products", enabled: platform?.types.includes("Products") },
                { key: "feedbacks" as const, label: "Feedbacks", enabled: platform?.types.includes("Feedbacks") },
                { key: "groups" as const, label: "Groups", enabled: platform?.types.includes("Groups") },
                { key: "categories" as const, label: "Categories", enabled: platform?.types.includes("Categories") },
              ].filter(o => o.enabled).map(o => (
                <label key={o.key} className={`import-option ${options[o.key] ? "on" : ""}`}>
                  <input type="checkbox" checked={options[o.key]} onChange={e => setOptions(opts => ({ ...opts, [o.key]: e.target.checked }))} style={{ display: "none" }} />
                  {options[o.key] ? <Icon name="check" size={13} /> : <span style={{ width: 13, height: 13, border: "1.5px solid var(--line-strong)", borderRadius: 3, display: "block" }} />}
                  {o.label}
                </label>
              ))}
            </div>

            <div className="import-warning">
              <Icon name="bell" size={15} />
              <span>Importing will <strong>not</strong> delete existing data. Duplicate products may be created if you import multiple times.</span>
            </div>

            <button className="btn" onClick={startImport} disabled={busy}>
              {busy ? <><Icon name="spinner" size={14} className="is-spinning" /> Importing…</> : <><Icon name="arrow-right" size={14} /> Import from {platform?.label}</>}
            </button>
          </div>
        )}
      </div>

      <div>
        <h3 style={{ marginBottom: 12, fontSize: "1rem", fontWeight: 700 }}>Import History</h3>
        {loading ? <div className="adm-loading"><Icon name="spinner" size={24} className="is-spinning" /></div>
          : jobs.length === 0
            ? <EmptyState icon="arrow-right" title="No Imports Yet" message="Start an import above to bring your data from another platform." />
            : (
              <div className="card" style={{ overflow: "hidden" }}>
                <table className="adm-table">
                  <thead><tr><th>Platform</th><th>Status</th><th>Progress</th><th>Started</th></tr></thead>
                  <tbody>
                    {jobs.map(j => (
                      <tr key={j.id}>
                        <td><strong>{j.platform}</strong></td>
                        <td><span className={`badge ${j.status === "done" ? "badge-green" : j.status === "error" ? "badge-red" : j.status === "running" ? "badge-blue" : "badge-gray"}`}>{j.status}</span></td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div className="import-progress-bar"><div className="import-progress-fill" style={{ width: j.total ? `${Math.round(j.imported / j.total * 100)}%` : "0%" }} /></div>
                            <span style={{ fontSize: ".78rem", color: "var(--ink-soft)" }}>{j.imported} / {j.total}</span>
                          </div>
                        </td>
                        <td>{new Date(j.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>

      <style>{`
        .import-platform-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px,1fr)); gap: 10px; }
        .import-platform-card { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; text-align: left; background: var(--surface-2); transition: all .15s; font-family: var(--font-sans); }
        .import-platform-card:hover { border-color: var(--brand); }
        .import-platform-card.on { border-color: var(--brand); background: var(--brand-soft); }
        .import-types { display: flex; flex-wrap: wrap; gap: 4px; }
        .import-options { display: flex; flex-wrap: wrap; gap: 8px; }
        .import-option { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1.5px solid var(--line-strong); border-radius: var(--radius-sm); cursor: pointer; font-size: .88rem; font-weight: 600; transition: all .15s; background: var(--surface-2); }
        .import-option.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
        .import-warning { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.3); border-radius: var(--radius-sm); font-size: .85rem; color: var(--ink); }
        .import-progress-bar { height: 6px; background: var(--line-strong); border-radius: 3px; overflow: hidden; width: 120px; }
        .import-progress-fill { height: 100%; background: var(--brand); border-radius: 3px; transition: width .3s; }
        .badge-red { background: rgba(239,68,68,.1); color: #b91c1c; border: 1px solid rgba(239,68,68,.3); }
        .badge-blue { background: rgba(59,130,246,.1); color: #1d4ed8; border: 1px solid rgba(59,130,246,.3); }
      `}</style>
    </div>
  );
};
