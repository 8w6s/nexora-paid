import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Sk, SkeletonStyles } from "../Skeleton";
import { ToggleSwitch } from "../ToggleSwitch";

interface Feature { key: string; label: string; enabled: boolean; }

export const AdminFeatures: React.FC = () => {
  const [list, setList] = useState<Feature[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = () => api.get<Feature[]>("/api/admin/features").then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggle = async (f: Feature) => {
    setSaving(f.key);
    try {
      await api.put("/api/admin/features", { key: f.key, enabled: !f.enabled });
      setList((prev) => prev?.map((x) => (x.key === f.key ? { ...x, enabled: !x.enabled } : x)) ?? null);
    } finally { setSaving(null); }
  };

  return (
    <div className="af">
      <p className="af-intro">Turn features on or off for your store. Changes apply immediately — no code or restart needed.</p>
      {!list ? (
        <div className="af-grid">{Array.from({ length: 6 }).map((_, i) => <Sk key={i} h={56} r={10} />)}<SkeletonStyles /></div>
      ) : (
        <div className="af-grid">
          {list.map((f) => (
            <div key={f.key} className={`af-item ${f.enabled ? "on" : ""}`}>
              <span className="af-label">{f.label}</span>
              <ToggleSwitch checked={f.enabled} onChange={() => toggle(f)} disabled={saving === f.key} label={`Toggle ${f.label}`} />
            </div>
          ))}
        </div>
      )}
      <style>{`
        .af-intro { color: var(--ink-soft); font-size: .88rem; margin-bottom: 16px; }
        .af-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
        .af-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); font-family: var(--font-sans); text-align: left; }
        .af-item.on { border-color: var(--brand); }
        .af-label { font-weight: 600; font-size: .9rem; color: var(--ink); }
      `}</style>
    </div>
  );
};
