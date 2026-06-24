import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";

type BlockType = "email" | "ip" | "country" | "vpn";
type ListMode = "blacklist" | "whitelist";

interface BlockEntry {
  id: string;
  type: BlockType;
  value: string;
  note?: string;
  createdAt: string;
}

const TYPE_LABELS: Record<BlockType, string> = {
  email: "Email",
  ip: "IP Address",
  country: "Country",
  vpn: "VPN / Proxy",
};

const COUNTRIES = [
  "AF",
  "AL",
  "AM",
  "AO",
  "AR",
  "AU",
  "AZ",
  "BA",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BN",
  "BO",
  "BR",
  "BT",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DZ",
  "EC",
  "EE",
  "EG",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FR",
  "GA",
  "GB",
  "GE",
  "GH",
  "GM",
  "GN",
  "GQ",
  "GR",
  "GT",
  "GW",
  "GY",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IN",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MD",
  "ME",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MR",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NE",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PG",
  "PH",
  "PK",
  "PL",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SI",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SY",
  "SZ",
  "TD",
  "TG",
  "TH",
  "TJ",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TZ",
  "UA",
  "UG",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VN",
  "VU",
  "WS",
  "YE",
  "ZA",
  "ZM",
  "ZW",
];

const EMPTY_FORM = { type: "email" as BlockType, value: "", note: "" };

export const AdminBlacklist: React.FC = () => {
  const [mode, setMode] = useState<ListMode>("blacklist");
  const [entries, setEntries] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    api
      .get<BlockEntry[]>(`/api/admin/${mode}`)
      .catch(() => [] as BlockEntry[])
      .then(setEntries)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [mode]);

  const add = async () => {
    if (!form.value.trim()) return setErr("Value is required");
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/admin/${mode}`, form);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.del(`/api/admin/${mode}/${id}`).catch(() => {});
    load();
  };

  const filtered = entries.filter(
    (e) =>
      e.value.toLowerCase().includes(search.toLowerCase()) ||
      e.note?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>{mode === "blacklist" ? "Blacklist" : "Whitelist"}</h2>
          <p className="muted">
            {mode === "blacklist"
              ? "Block specific emails, IPs, or countries from your store."
              : "Allow specific emails or IPs to bypass fraud protection."}
          </p>
        </div>
        <div className="bl-mode-switch">
          <button
            className={`bl-mode-btn ${mode === "blacklist" ? "on" : ""}`}
            onClick={() => setMode("blacklist")}
          >
            <Icon name="shield" size={13} /> Blacklist
          </button>
          <button
            className={`bl-mode-btn ${mode === "whitelist" ? "on" : ""}`}
            onClick={() => setMode("whitelist")}
          >
            <Icon name="check" size={13} /> Whitelist
          </button>
        </div>
      </div>

      <div
        className="card"
        style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div className="adm-section-label">Add to {mode}</div>
        {err && <div className="pe-err">{err}</div>}
        <div className="bl-add-row">
          <select
            className="input"
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({ ...f, type: e.target.value as BlockType, value: "" }))
            }
          >
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          {form.type === "country" ? (
            <select
              className="input"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            >
              <option value="">Select country…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : form.type === "vpn" ? (
            <select
              className="input"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            >
              <option value="">Select option…</option>
              <option value="vpn">VPN</option>
              <option value="proxy">Proxy</option>
              <option value="tor">Tor</option>
              <option value="datacenter">Datacenter</option>
            </select>
          ) : (
            <input
              className="input"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder={form.type === "email" ? "user@example.com" : "192.168.1.1"}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          )}

          <input
            className="input"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Note (optional)"
          />
          <button className="btn" onClick={add} disabled={busy}>
            {busy ? (
              <Icon name="spinner" size={14} className="is-spinning" />
            ) : (
              <Icon name="plus" size={14} />
            )}{" "}
            Add
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Icon
            name="search"
            size={15}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--ink-faint)",
            }}
          />
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${mode}...`}
          />
        </div>
      </div>

      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={24} className="is-spinning" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="shield"
          title={`${mode === "blacklist" ? "Blacklist" : "Whitelist"} is Empty`}
          message={`Add ${mode === "blacklist" ? "emails, IPs, countries, or VPNs to block" : "emails or IPs to always allow"}.`}
        />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Value</th>
                <th>Note</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="badge badge-gray">{TYPE_LABELS[e.type]}</span>
                  </td>
                  <td>
                    <code style={{ fontSize: ".85rem" }}>{e.value}</code>
                  </td>
                  <td>{e.note ?? "—"}</td>
                  <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm btn-danger-icon"
                      onClick={() => remove(e.id)}
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
        .bl-mode-switch { display: flex; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); overflow: hidden; }
        .bl-mode-btn { display: flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--surface-2); border: none; color: var(--ink-soft); font-weight: 600; font-size: .85rem; cursor: pointer; font-family: var(--font-sans); transition: all .15s; }
        .bl-mode-btn.on { background: var(--brand); color: #fff; }
        .bl-add-row { display: grid; grid-template-columns: 140px minmax(220px, 1.4fr) minmax(180px, 1fr) auto; gap: 10px; align-items: flex-start; max-width: 920px; }
        @media (max-width: 640px) { .bl-add-row { grid-template-columns: 1fr; max-width: none; } }
      `}</style>
    </div>
  );
};
