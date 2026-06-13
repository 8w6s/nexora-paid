import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Dropdown } from "../Dropdown";
import { Sk, SkeletonStyles } from "../Skeleton";
import { useToast } from "../Toast";
import { ToggleSwitch } from "../ToggleSwitch";

interface Field {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
  placeholder?: string;
}
interface Provider {
  id: string;
  label: string;
  kind: string;
  countries: string[] | "*";
  note?: string;
  fields: Field[];
  enabled: boolean;
  config: Record<string, string | boolean>;
}

const COUNTRIES = [
  { code: "*", name: "Worldwide (no restriction)" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Japan" },
  { code: "SG", name: "Singapore" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "IE", name: "Ireland" },
  { code: "VN", name: "Vietnam" },
];

const KIND_LABEL: Record<string, string> = {
  "crypto-native": "Crypto (self-hosted)",
  "crypto-gateway": "Crypto gateway",
  card: "Cards",
  wallet: "Wallet",
  manual: "Manual",
};

export const AdminPayments: React.FC = () => {
  const [list, setList] = useState<Provider[] | null>(null);
  const [country, setCountry] = useState("*");
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const toast = useToast();

  const load = () =>
    api
      .get<{ shopCountry: string; providers: Provider[] }>("/api/admin/payments")
      .then((d) => {
        setList(d.providers);
        setCountry(d.shopCountry);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, [load]);

  const saveCountry = async (c: string) => {
    setCountry(c);
    try {
      await api.put("/api/admin/payments/country", { country: c });
      toast.success("Country saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };
  const toggle = async (p: Provider) => {
    await api.put(`/api/admin/payments/${p.id}/enabled`, { enabled: !p.enabled });
    setList(
      (prev) => prev?.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x)) ?? null,
    );
  };
  const saveConfig = async (p: Provider) => {
    const config = draft[p.id] ?? {};
    try {
      await api.put(`/api/admin/payments/${p.id}/config`, { config });
      setDraft((d) => ({ ...d, [p.id]: {} }));
      toast.success(`${p.label} settings saved.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };
  const setField = (pid: string, key: string, val: string) =>
    setDraft((d) => ({ ...d, [pid]: { ...(d[pid] ?? {}), [key]: val } }));

  return (
    <div className="pay-admin">
      <SkeletonStyles />

      <div className="card pa-country">
        <div>
          <strong>Shop country</strong>
          <p className="muted">
            Only payment methods available in this country are shown to buyers.
          </p>
        </div>
        <Dropdown<string>
          value={country}
          onChange={(v) => saveCountry(v)}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
          width={260}
        />
      </div>

      {!list ? (
        <div className="pa-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Sk key={i} h={120} r={12} />
          ))}
        </div>
      ) : (
        <div className="pa-grid">
          {list.map((p) => {
            const served =
              p.countries === "*" || country === "*" || (p.countries as string[]).includes(country);
            return (
              <div key={p.id} className={`card pa-card ${p.enabled ? "on" : ""}`}>
                <div className="pa-head">
                  <div>
                    <strong>{p.label}</strong>
                    <span className="pa-kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
                    {!served && <span className="pa-warn">Not available in {country}</span>}
                  </div>
                  <ToggleSwitch
                    checked={p.enabled}
                    onChange={() => toggle(p)}
                    label={`Toggle ${p.label}`}
                  />
                </div>
                {p.note && <p className="muted pa-note">{p.note}</p>}
                {p.enabled && (
                  <div className="pa-fields">
                    {p.fields.map((f) => (
                      <label key={f.key}>
                        <span>
                          {f.label}
                          {f.optional ? " (optional)" : ""}
                          {f.secret && p.config[f.key] === true ? " — saved" : ""}
                        </span>
                        <input
                          className="input"
                          type={f.secret ? "password" : "text"}
                          placeholder={
                            f.secret && p.config[f.key] === true
                              ? "•••••• (leave blank to keep)"
                              : (f.placeholder ?? "")
                          }
                          value={
                            draft[p.id]?.[f.key] ??
                            (f.secret ? "" : (p.config[f.key] as string) || "")
                          }
                          onChange={(e) => setField(p.id, f.key, e.target.value)}
                        />
                        {f.hint && <small className="pa-hint">{f.hint}</small>}
                      </label>
                    ))}
                    <button className="btn" onClick={() => saveConfig(p)}>
                      Save {p.label}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .pay-admin { display: flex; flex-direction: column; gap: 16px; }
        .pa-country { padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .pa-country select { max-width: 280px; }
        .muted { color: var(--ink-soft); font-size: .84rem; }
        .pa-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
        .pa-card { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
        .pa-card.on { border-color: var(--brand); }
        .pa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .pa-head strong { display: block; font-size: .95rem; }
        .pa-kind { font-size: .72rem; color: var(--ink-faint); }
        .pa-warn { display: block; font-size: .72rem; color: var(--warn,#b25e00); margin-top: 2px; }
        .pa-note { margin: -2px 0 0; }
        .pa-fields { display: flex; flex-direction: column; gap: 9px; padding-top: 8px; border-top: 1px solid var(--line); }
        .pa-fields label { display: flex; flex-direction: column; gap: 4px; font-size: .76rem; font-weight: 600; color: var(--ink-soft); }
        .pa-hint { font-size: .72rem; font-weight: 400; color: var(--ink-faint); line-height: 1.4; }
      `}</style>
    </div>
  );
};
