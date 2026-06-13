import type React from "react";
import { useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { Dropdown } from "../Dropdown";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { useToast } from "../Toast";

interface Coupon {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  maxUses: number | null;
  usedCount: number;
  minOrderUsd: number;
  active: boolean;
  expiresAt: number | null;
}
const blank = {
  code: "",
  type: "percent" as "percent" | "fixed",
  value: "10",
  minOrderUsd: "",
  maxUses: "",
};

export const AdminCoupons: React.FC = () => {
  const [list, setList] = useState<Coupon[]>([]);
  const [form, setForm] = useState(blank);
  const toast = useToast();

  const load = () =>
    api
      .get<Coupon[]>("/api/admin/coupons")
      .then(setList)
      .catch(() => {});
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    try {
      const body: any = {
        code: form.code,
        type: form.type,
        value: Number(form.value),
        minOrderUsd: Number(form.minOrderUsd),
      };
      if (form.maxUses) body.maxUses = Number(form.maxUses);
      await api.post("/api/admin/coupons", body);
      setForm(blank);
      toast.success("Coupon created.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };
  const toggle = async (c: Coupon) => {
    await api.patch(`/api/admin/coupons/${c.id}`, { active: !c.active });
    load();
  };
  const remove = async (c: Coupon) => {
    await api.del(`/api/admin/coupons/${c.id}`);
    load();
  };

  return (
    <div className="cpn">
      <div className="cpn-grid">
        <div className="card form-card">
          <h3>New coupon</h3>
          <label>
            <span>Code</span>
            <input
              className="input"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="WELCOME10"
            />
          </label>
          <label>
            <span>Discount type</span>
            <Dropdown<"percent" | "fixed">
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={[
                {
                  value: "percent",
                  label: "Percent off",
                  icon: "zap",
                  desc: "Take N% off the order total",
                },
                {
                  value: "fixed",
                  label: "Fixed amount",
                  icon: "receipt",
                  desc: "Take a flat $ off the order total",
                },
              ]}
              width="100%"
            />
          </label>
          <label>
            <span>{form.type === "percent" ? "Percent off" : "Amount off (USD)"}</span>
            <NumberInput
              decimal
              min={0}
              value={form.value}
              onChange={(v) => setForm({ ...form, value: v })}
            />
          </label>
          <label>
            <span>Min order (USD)</span>
            <NumberInput
              decimal
              min={0}
              value={form.minOrderUsd}
              onChange={(v) => setForm({ ...form, minOrderUsd: v })}
            />
          </label>
          <label>
            <span>Max uses (blank = unlimited)</span>
            <NumberInput
              min={1}
              value={form.maxUses}
              onChange={(v) => setForm({ ...form, maxUses: v })}
            />
          </label>
          <button className="btn" onClick={create} disabled={!form.code.trim()}>
            Create coupon
          </button>
        </div>

        <div className="card table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th className="num">Min</th>
                  <th className="num">Used</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      No coupons yet.
                    </td>
                  </tr>
                ) : (
                  list.map((c) => (
                    <tr key={c.id} className={c.active ? "" : "off"}>
                      <td>
                        <code className="code">{c.code}</code>
                      </td>
                      <td>{c.type === "percent" ? `${c.value}% off` : `${fmtUsd(c.value)} off`}</td>
                      <td className="num">{c.minOrderUsd > 0 ? fmtUsd(c.minOrderUsd) : "—"}</td>
                      <td className="num">
                        {c.usedCount}
                        {c.maxUses ? `/${c.maxUses}` : ""}
                      </td>
                      <td>
                        <button
                          className={`badge ${c.active ? "on" : "offb"}`}
                          onClick={() => toggle(c)}
                        >
                          {c.active ? "Active" : "Off"}
                        </button>
                      </td>
                      <td>
                        <button
                          className="lnk del"
                          onClick={() => remove(c)}
                          aria-label="Delete coupon"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <style>{`
        .cpn { display: flex; flex-direction: column; gap: 14px; }
        .cpn-grid { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
        .form-card { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
        .form-card h3 { font-size: 1rem; }
        .form-card label { display: flex; flex-direction: column; gap: 5px; font-size: .78rem; font-weight: 600; color: var(--ink-soft); }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 11px 14px; border-bottom: 1px solid var(--line); }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .code { font-family: monospace; font-weight: 700; background: var(--surface-2); padding: 3px 8px; border-radius: 6px; }
        tr.off { opacity: .5; }
        .empty { text-align: center; color: var(--ink-faint); padding: 40px; }
        .badge { border: none; cursor: pointer; padding: 4px 11px; border-radius: 100px; font-size: .72rem; font-weight: 600; }
        .badge.on { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.offb { color: var(--ink-faint); background: var(--surface-2); }
        .lnk { background: none; border: none; cursor: pointer; color: var(--ink-faint); display: flex; }
        .lnk.del:hover { color: var(--price); }
        @media (max-width: 760px) { .cpn-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};
