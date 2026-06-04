import React, { useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { Icon } from "../Icon";
import { EmptyState } from "../EmptyState";

interface Order { id: string; status: string; totalUsd: number; ltcAmount: string; createdAt: number; }
interface CustomerDetail {
  id: string;
  email: string;
  status: "active" | "banned";
  createdAt: number;
  orders: Order[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting", awaiting_payment: "Awaiting", underpaid: "Underpaid",
  paid: "Paid", completed: "Completed", expired: "Expired", cancelled: "Cancelled",
};

export const AdminCustomerDetail: React.FC<{
  customerId: string;
  onBack: () => void;
  onOpenOrder: (id: string) => void;
}> = ({ customerId, onBack, onOpenOrder }) => {
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.get<CustomerDetail>(`/api/admin/customers/${customerId}`).then(setC).catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
  useEffect(() => { load(); }, [customerId]);

  const toggleBan = async () => {
    if (!c) return;
    setBusy(true);
    const next = c.status === "active" ? "banned" : "active";
    try {
      await api.put(`/api/admin/customers/${c.id}/status`, { status: next });
      setC({ ...c, status: next });
    } catch (e) { setErr(e instanceof Error ? e.message : "Update failed"); }
    finally { setBusy(false); }
  };

  if (err) return <div className="acd"><button className="btn btn-ghost" onClick={onBack}><Icon name="arrow-right" size={14} className="flip" /> Back</button><div className="err">{err}</div></div>;
  if (!c) return <div className="acd"><button className="btn btn-ghost" onClick={onBack}><Icon name="arrow-right" size={14} className="flip" /> Back</button><EmptyState icon="spinner" title="Loading…" compact /></div>;

  const paid = c.orders.filter((o) => o.status === "paid" || o.status === "completed");
  const totalSpent = paid.reduce((s, o) => s + o.totalUsd, 0);

  return (
    <div className="acd">
      <header className="acd-head">
        <div>
          <button className="btn btn-ghost" onClick={onBack} type="button"><Icon name="arrow-right" size={14} className="flip" /> Back to customers</button>
          <h1>{c.email}</h1>
          <p className="muted">Joined {new Date(c.createdAt).toLocaleString()}</p>
        </div>
        <div className="acd-actions">
          <span className={`badge ${c.status}`}>{c.status === "active" ? "Active" : "Banned"}</span>
          <button className={`btn ${c.status === "active" ? "btn-danger" : ""}`} onClick={toggleBan} disabled={busy} type="button">
            {busy ? <><Icon name="spinner" size={14} className="is-spinning" /> Working…</> : (c.status === "active" ? "Ban customer" : "Unban customer")}
          </button>
        </div>
      </header>

      <div className="acd-stats">
        <div className="stat card"><span>Orders</span><strong>{c.orders.length}</strong></div>
        <div className="stat card"><span>Paid orders</span><strong>{paid.length}</strong></div>
        <div className="stat card"><span>Total spent</span><strong className="price">{fmtUsd(totalSpent)}</strong></div>
      </div>

      <section className="card acd-pane">
        <h3><Icon name="receipt" size={16} variant="badge" /> Order history</h3>
        {c.orders.length === 0 ? (
          <EmptyState icon="receipt" title="No orders yet" desc="This customer has not made any purchase yet." compact />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Status</th><th className="num">Total</th><th>When</th></tr></thead>
              <tbody>
                {c.orders.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => onOpenOrder(o.id)} title="View order">
                    <td className="mono">{o.id.slice(0, 8)}</td>
                    <td><span className={`badge ${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                    <td className="num price">{fmtUsd(o.totalUsd)} <span className="muted sm">({o.ltcAmount} LTC)</span></td>
                    <td className="muted sm">{new Date(o.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style>{`
        .acd { display: flex; flex-direction: column; gap: 18px; }
        .acd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
        .acd-head h1 { font-size: 1.4rem; font-weight: 700; color: var(--ink); margin: 6px 0 2px; word-break: break-all; }
        .acd-head .muted { color: var(--ink-faint); font-size: .82rem; }
        .acd-actions { display: flex; align-items: center; gap: 10px; }
        .acd-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
        .stat { padding: 14px 18px; display: flex; flex-direction: column; gap: 3px; }
        .stat span { font-size: .74rem; color: var(--ink-faint); }
        .stat strong { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
        .acd-pane { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
        .acd-pane h3 { display: flex; align-items: center; gap: 10px; font-size: 1rem; font-weight: 700; color: var(--ink); }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: .88rem; vertical-align: middle; }
        th { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { color: var(--ink-soft); } .sm { font-size: .76rem; }
        .mono { font-family: monospace; font-size: .82rem; }
        .clickable { cursor: pointer; transition: background .12s var(--ease); }
        .clickable:hover { background: var(--surface-2); }
        .badge { padding: 4px 10px; border-radius: 100px; font-size: .72rem; font-weight: 600; }
        .badge.active, .badge.paid, .badge.completed { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.banned { color: var(--price); background: var(--price-soft); }
        .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
        .badge.expired, .badge.cancelled { color: var(--ink-faint); background: var(--surface-2); }
        .btn-danger { background: var(--price); border-color: var(--price); }
        .btn-ghost .flip { transform: rotate(180deg); }
        .err { background: var(--price-soft); color: var(--price); padding: 9px 12px; border-radius: var(--radius-sm); font-size: .84rem; }
      `}</style>
    </div>
  );
};
