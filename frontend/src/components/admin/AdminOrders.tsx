import { useCallback, useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { Sk, SkeletonStyles } from "../Skeleton";
import { AdminOrderDetail } from "./AdminOrderDetail";

interface AdminOrder {
  id: string;
  status: string;
  email: string;
  totalUsd: number;
  ltcAmount: string;
  confirmations: number;
  ltcAddress: string;
  paidTxId: string | null;
  createdAt: number;
  items: { name: string; quantity: number }[];
}
const STATUSES = ["all", "pending", "underpaid", "paid", "completed", "expired", "cancelled"];
const label: Record<string, string> = {
  pending: "Awaiting",
  awaiting_payment: "Awaiting",
  underpaid: "Underpaid",
  paid: "Paid",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const AdminOrders: React.FC = () => {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback((f: string) => {
    api
      .get<AdminOrder[]>(`/api/admin/orders${f !== "all" ? `?status=${f}` : ""}`)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    setLoaded(false);
    load(filter);
    // Poll every 30s instead of 8s, and pause when the tab is backgrounded.
    // Combined with the backend's new pagination + single-batched items
    // query, this drops admin-orders polling cost from ~50k+1 queries every
    // 8s to a single bounded query every 30s while the tab is visible.
    const t = setInterval(() => {
      if (!document.hidden) load(filter);
    }, 30000);
    const onVis = () => {
      if (!document.hidden) load(filter);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [filter, load]);

  if (openId) return <AdminOrderDetail orderId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="ao">
      <SkeletonStyles />
      <div className="filters" style={{ alignItems: "center" }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`chip ${filter === s ? "active" : ""}`}
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "All" : (label[s] ?? s)}
          </button>
        ))}
        <a
          className="chip"
          href={`/api/admin/orders/export.csv${filter !== "all" ? `?status=${filter}` : ""}`}
          download
          style={{ marginLeft: "auto", textDecoration: "none" }}
          title="Download CSV of current filter"
        >
          Export CSV
        </a>
      </div>
      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Items</th>
                <th className="num">Total</th>
                <th className="num">Conf</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk${i}`}>
                    <td>
                      <Sk w={90} h={13} />
                      <Sk w={120} h={10} style={{ marginTop: 4 }} />
                    </td>
                    <td>
                      <Sk w={120} h={12} />
                    </td>
                    <td>
                      <Sk w={140} h={20} r={100} />
                    </td>
                    <td className="num">
                      <Sk w={56} h={13} style={{ marginLeft: "auto" }} />
                    </td>
                    <td className="num">
                      <Sk w={24} h={13} style={{ marginLeft: "auto" }} />
                    </td>
                    <td>
                      <Sk w={64} h={20} r={100} />
                    </td>
                    <td>
                      <Sk w={100} h={11} />
                    </td>
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    No orders.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr
                    key={o.id}
                    className="clickable"
                    onClick={() => setOpenId(o.id)}
                    title="View order details"
                  >
                    <td>
                      <strong className="oid">{o.id}</strong>
                      <div className="addr" title={o.ltcAddress}>
                        {o.ltcAddress.slice(0, 16)}…
                      </div>
                    </td>
                    <td className="muted">{o.email}</td>
                    <td>
                      <div className="tags">
                        {o.items.map((i, k) => (
                          <span key={k} className="pill">
                            {i.name} ×{i.quantity}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num price">
                      {fmtUsd(o.totalUsd)}
                      <div className="muted sm">{o.ltcAmount} LTC</div>
                    </td>
                    <td className="num">{o.confirmations}</td>
                    <td>
                      <span className={`badge ${o.status}`}>{label[o.status] ?? o.status}</span>
                    </td>
                    <td className="muted sm">{new Date(o.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`
        .ao .filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
        .chip { background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink-soft); padding: 5px 12px; border-radius: 100px; cursor: pointer; font-family: var(--font-sans); font-weight: 600; font-size: .8rem; }
        .chip.active { background: var(--brand); color: #fff; border-color: var(--brand); }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { color: var(--ink-soft); } .sm { font-size: .76rem; }
        .oid { font-variant-numeric: tabular-nums; font-size: .85rem; }
        .addr { font-family: monospace; font-size: .72rem; color: var(--ink-faint); }
        .tags { display: flex; flex-wrap: wrap; gap: 5px; max-width: 220px; }
        .empty { text-align: center; color: var(--ink-faint); padding: 40px; }
        .badge { padding: 4px 10px; border-radius: 100px; font-size: .72rem; font-weight: 600; }
        .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
        .badge.paid, .badge.completed { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.expired, .badge.cancelled { color: var(--price); background: var(--price-soft); }
        tr.clickable { cursor: pointer; transition: background .12s var(--ease); }
        tr.clickable:hover { background: var(--surface-2); }
      `}</style>
    </div>
  );
};
