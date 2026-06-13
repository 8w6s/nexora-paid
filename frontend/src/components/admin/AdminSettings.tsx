import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { useToast } from "../Toast";

interface SettingsView {
  store_name?: string | null;
  ltc_xpub?: string | null;
  required_confirmations?: string | null;
  payment_window_minutes?: string | null;
  xpub_valid?: boolean;
  xpub_type?: string;
  xpub_sample_address?: string;
}

export const AdminSettings: React.FC = () => {
  const [s, setS] = useState<SettingsView | null>(null);
  const [xpub, setXpub] = useState("");
  const [conf, setConf] = useState("2");
  const [windowMin, setWindowMin] = useState("15");
  const [storeName, setStoreName] = useState("Nexora");
  const toast = useToast();

  const load = () =>
    api
      .get<SettingsView>("/api/admin/settings")
      .then((d) => {
        setS(d);
        setConf(String(d.required_confirmations ?? 2));
        setWindowMin(String(d.payment_window_minutes ?? 15));
        setStoreName(d.store_name ?? "Nexora");
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    try {
      const body: Record<string, unknown> = {
        required_confirmations: Number(conf) || 2,
        payment_window_minutes: Number(windowMin) || 15,
        store_name: storeName,
      };
      if (xpub.trim()) body.ltc_xpub = xpub.trim();
      const r = await api.put<{ xpub_type: string | null; xpub_sample_address: string | null }>(
        "/api/admin/settings",
        body,
      );
      toast.success(
        `Settings saved.${r.xpub_type ? ` Wallet: ${r.xpub_type}, first address ${r.xpub_sample_address}` : ""}`,
      );
      setXpub("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (!s)
    return (
      <div className="set-loading">
        <Icon name="spinner" size={24} className="is-spinning" />
      </div>
    );

  return (
    <div className="set">
      <div className="card sec">
        <span className="section-title">
          <Icon name="key" size={15} /> Litecoin wallet (xpub)
        </span>
        {s.ltc_xpub ? (
          <div className={`xpub-status ${s.xpub_valid ? "ok" : "bad"}`}>
            {s.xpub_valid ? (
              <>
                <Icon name="check" size={14} /> Configured · type <strong>{s.xpub_type}</strong> ·
                first address <code>{s.xpub_sample_address}</code>
              </>
            ) : (
              "Stored xpub is invalid"
            )}
          </div>
        ) : (
          <div className="xpub-status bad">
            No wallet configured — checkout is disabled until you add one.
          </div>
        )}
        <label>
          <span>Set / replace extended public key (Ltub / Mtub / zpub)</span>
          <input
            className="input"
            value={xpub}
            onChange={(e) => setXpub(e.target.value)}
            placeholder="Ltub… / zpub…"
          />
        </label>
        <p className="hint">
          ⚠️ Paste an extended <strong>public</strong> key only — never a private key. Verify the
          first address matches your wallet before going live.
        </p>
      </div>

      <div className="card sec">
        <span className="section-title">
          <Icon name="credit-card" size={15} /> Payment
        </span>
        <div className="row2">
          <label>
            <span>Required confirmations</span>
            <NumberInput min={1} max={12} value={conf} onChange={setConf} />
          </label>
          <label>
            <span>Payment window (minutes)</span>
            <NumberInput min={5} max={120} value={windowMin} onChange={setWindowMin} />
          </label>
        </div>
      </div>

      <div className="card sec">
        <span className="section-title">
          <Icon name="home" size={15} /> Store
        </span>
        <label>
          <span>Store name</span>
          <input
            className="input"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
          />
        </label>
      </div>

      <button className="btn" onClick={save}>
        Save settings
      </button>

      <style>{`
        .set { display: flex; flex-direction: column; gap: 16px; max-width: 640px; }
        .set-loading { padding: 50px; text-align: center; color: var(--ink-soft); }
        .sec { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
        .section-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: .9rem; }
        .section-title svg { color: var(--brand); }
        .set label { display: flex; flex-direction: column; gap: 5px; font-size: .78rem; font-weight: 600; color: var(--ink-soft); }
        .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .xpub-status { font-size: .82rem; padding: 9px 12px; border-radius: var(--radius-sm); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .xpub-status code { font-family: monospace; font-size: .78rem; }
        .xpub-status.ok { background: var(--auto-soft,#e6f4ea); color: var(--auto,#137333); }
        .xpub-status.bad { background: var(--warn-soft,#fff4e5); color: var(--warn,#b25e00); }
        .hint { font-size: .78rem; color: var(--ink-faint); line-height: 1.5; }
        @media (max-width: 560px) { .row2 { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};
