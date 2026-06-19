import { useCallback, useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { Sk, SkeletonStyles } from "../Skeleton";
import { AdminCustomerDetail } from "./AdminCustomerDetail";
import { AdminOrderDetail } from "./AdminOrderDetail";

interface Customer {
  id: string;
  email: string;
  status: "active" | "banned";
  createdAt: number;
  orderCount: number;
  totalSpentUsd: number;
}

export const AdminCustomers: React.FC = () => {
  const [list, setList] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // view tracks the open page; orderFromCustomer remembers the customer to
  // return to when closing an order opened from a customer detail.
  const [view, setView] = useState<
    { type: "customer"; id: string } | { type: "order"; id: string; fromCustomer?: string } | null
  >(null);

  const load = useCallback(() => {
    api
      .get<Customer[]>("/api/admin/customers")
      .then(setList)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (view?.type === "order") {
    const back = view.fromCustomer
      ? () => setView({ type: "customer", id: view.fromCustomer! })
      : () => setView(null);
    return <AdminOrderDetail orderId={view.id} onBack={back} />;
  }
  if (view?.type === "customer") {
    return (
      <AdminCustomerDetail
        customerId={view.id}
        onBack={() => {
          setView(null);
          load();
        }}
        onOpenOrder={(oid) => setView({ type: "order", id: oid, fromCustomer: view.id })}
      />
    );
  }

  const toggleBan = async (c: Customer) => {
    setBusy(c.id);
    const next = c.status === "active" ? "banned" : "active";
    try {
      await api.put(`/api/admin/customers/${c.id}/status`, { status: next });
      setList((prev) => prev?.map((x) => (x.id === c.id ? { ...x, status: next } : x)) ?? null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cust">
      <SkeletonStyles />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <p className="intro" style={{ margin: 0 }}>
          Your registered customers. Ban to block login + revoke their sessions.
        </p>
        <a
          className="chip"
          href="/api/admin/customers/export.csv?role=customer"
          download
          style={{ textDecoration: "none" }}
          title="Download CSV of customers"
        >
          Export CSV
        </a>
      </div>
      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Orders</th>
                <th className="num">Total spent</th>
                <th>Joined</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!list ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Sk w={180} h={13} />
                    </td>
                    <td className="num">
                      <Sk w={24} h={13} style={{ marginLeft: "auto" }} />
                    </td>
                    <td className="num">
                      <Sk w={56} h={13} style={{ marginLeft: "auto" }} />
                    </td>
                    <td>
                      <Sk w={90} h={13} />
                    </td>
                    <td>
                      <Sk w={56} h={20} r={100} />
                    </td>
                    <td>
                      <Sk w={60} h={13} />
                    </td>
                  </tr>
                ))
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No customers yet.
                  </td>
                </tr>
              ) : (
                list.map((c) => (
                  <tr
                    key={c.id}
                    className={`clickable ${c.status === "banned" ? "banned" : ""}`}
                    onClick={() => setView({ type: "customer", id: c.id })}
                    title="View customer"
                  >
                    <td className="email">{c.email}</td>
                    <td className="num">{c.orderCount}</td>
                    <td className="num price">{fmtUsd(c.totalSpentUsd)}</td>
                    <td className="muted sm">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td>
                      <span className={`badge ${c.status}`}>
                        {c.status === "active" ? "Active" : "Banned"}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="lnk" disabled={busy === c.id} onClick={() => toggleBan(c)}>
                        {c.status === "active" ? "Ban" : "Unban"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`
        .cust .intro { color: var(--ink-soft); font-size: .88rem; margin-bottom: 14px; }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); }
        td:last-child, th:last-child { text-align: right; }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .email { font-weight: 600; font-size: .88rem; }
        .muted { color: var(--ink-soft); } .sm { font-size: .8rem; }
        tr.banned { opacity: .55; }
        tr.clickable { cursor: pointer; transition: background .12s var(--ease); }
        tr.clickable:hover { background: var(--surface-2); }
        .empty { text-align: center; color: var(--ink-faint); padding: 40px; }
        .badge { padding: 4px 11px; border-radius: 100px; font-size: .72rem; font-weight: 600; }
        .badge.active { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.banned { color: var(--price); background: var(--price-soft); }
        .lnk { background: none; border: 1px solid transparent; color: var(--brand); cursor: pointer; font-weight: 600; font-size: .82rem; padding: 6px 12px; min-height: 30px; border-radius: var(--radius-sm); transition: background .12s, border-color .12s; }
        .lnk:hover { background: var(--brand-soft); }
        .lnk:disabled { opacity: .5; cursor: not-allowed; }
      `}</style>
    </div>
  );
};
