import type React from "react";
import { useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { Chart } from "../Chart";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { Sk, SkeletonStyles } from "../Skeleton";
import { AdminLicenseCard } from "./AdminLicenseCard";

interface RecentOrder {
  id: string;
  email: string;
  status: string;
  totalUsd: number;
  createdAt: number;
}
interface Stats {
  totalOrders: number;
  ordersByStatus: Record<string, number>;
  revenueUsd: number;
  revenueLtc: string;
  topProducts: { id: string; name: string; sold: number; priceUsd: number }[];
  lowStock: { id: string; name: string; available: number }[];
  revenueSeries: { day: string; revenueUsd: number; orders: number }[];
  recentOrders: RecentOrder[];
  rangeDays: number;
}

const RANGES: { days: number; label: string }[] = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

export const AdminOverview: React.FC = () => {
  const [s, setS] = useState<Stats | null>(null);
  const [days, setDays] = useState(14);
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");

  useEffect(() => {
    const load = () =>
      api
        .get<Stats>(`/api/admin/stats?days=${days}`)
        .then(setS)
        .catch(() => {});
    load();
    // Poll every 30s while the tab is visible; pause when backgrounded so an
    // open admin tab doesn't burn API calls all day. Reload on focus return.
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 30000);
    const onVis = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [days]);

  if (!s)
    return (
      <div className="ov">
        <div className="cards">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat card" style={{ gap: 8 }}>
              <Sk w={90} h={11} />
              <Sk w={70} h={26} />
            </div>
          ))}
        </div>
        <div className="card chart-card">
          <Sk w={160} h={14} style={{ marginBottom: 14 }} />
          <Sk h={120} r={8} />
        </div>
        <div className="two-col">
          <div className="card list-card">
            <Sk w={120} h={14} style={{ marginBottom: 14 }} />
            <Sk h={70} r={8} />
          </div>
          <div className="card list-card">
            <Sk w={120} h={14} style={{ marginBottom: 14 }} />
            <Sk h={70} r={8} />
          </div>
        </div>
        <SkeletonStyles />
        <style>{`
          .ov { display: flex; flex-direction: column; gap: 16px; }
          .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
          .stat { padding: 14px 18px; display: flex; flex-direction: column; }
          .chart-card, .list-card { padding: 16px 18px; }
          .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          @media (max-width: 680px) { .two-col { grid-template-columns: 1fr; } }
        `}</style>
      </div>
    );

  const series = s.revenueSeries;
  const isRevenue = metric === "revenue";

  return (
    <div className="ov">
      <AdminLicenseCard />
      <div className="cards">
        <div className="stat card">
          <span>Revenue (paid)</span>
          <strong className="price">{fmtUsd(s.revenueUsd)}</strong>
          <em>{s.revenueLtc} LTC</em>
        </div>
        <div className="stat card">
          <span>Total orders</span>
          <strong>{s.totalOrders}</strong>
        </div>
        <div className="stat card">
          <span>Paid / Completed</span>
          <strong>{(s.ordersByStatus.paid ?? 0) + (s.ordersByStatus.completed ?? 0)}</strong>
        </div>
        <div className="stat card">
          <span>Awaiting payment</span>
          <strong>
            {(s.ordersByStatus.pending ?? 0) +
              (s.ordersByStatus.awaiting_payment ?? 0) +
              (s.ordersByStatus.underpaid ?? 0)}
          </strong>
        </div>
      </div>

      <div className="card chart-card">
        <div className="chart-head">
          <div className="chart-title-group">
            <span className="section-title">
              <Icon name={isRevenue ? "zap" : "receipt"} size={15} />{" "}
              {isRevenue ? "Revenue" : "Orders"}
            </span>
            <div className="metric-chips">
              <button
                className={`metric-chip ${isRevenue ? "on" : ""}`}
                onClick={() => setMetric("revenue")}
              >
                Revenue ($)
              </button>
              <button
                className={`metric-chip ${!isRevenue ? "on" : ""}`}
                onClick={() => setMetric("orders")}
              >
                Orders (qty)
              </button>
            </div>
          </div>
          <div className="range-chips" role="tablist" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.days}
                role="tab"
                aria-selected={days === r.days}
                className={`range-chip ${days === r.days ? "on" : ""}`}
                onClick={() => setDays(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-wrap">
          <Chart
            data={series.map((d) => ({
              label: d.day,
              value: isRevenue ? d.revenueUsd : d.orders,
              hoverLabel: isRevenue ? `${d.orders} order${d.orders === 1 ? "" : "s"}` : undefined,
            }))}
            isCurrency={isRevenue}
          />
        </div>
      </div>

      <div className="two-col">
        <div className="card list-card">
          <span className="section-title">
            <Icon name="box" size={15} /> Top sellers
          </span>
          {s.topProducts.filter((p) => p.sold > 0).length === 0 ? (
            <EmptyState
              icon="box"
              title="No sales yet"
              desc="Once orders are paid, your best-performing products will appear here."
              compact
            />
          ) : (
            <ol>
              {s.topProducts
                .filter((p) => p.sold > 0)
                .map((p) => (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    <span className="muted">
                      {p.sold} sold · {fmtUsd(p.priceUsd)}
                    </span>
                  </li>
                ))}
            </ol>
          )}
        </div>
        <div className="card list-card">
          <span className="section-title">
            <Icon name="bell" size={15} /> Low stock (≤5)
          </span>
          {s.lowStock.length === 0 ? (
            <EmptyState
              icon="check"
              title="All well stocked"
              desc="No products are running low on keys."
              compact
            />
          ) : (
            <ol>
              {s.lowStock.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className={p.available === 0 ? "danger" : "warn"}>{p.available} left</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="card list-card">
        <span className="section-title">
          <Icon name="receipt" size={15} /> Latest invoices
        </span>
        {s.recentOrders.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No invoices yet"
            desc="When customers buy, their invoices will show up here in real time."
            compact
          />
        ) : (
          <div className="recent-list">
            {s.recentOrders.map((o) => (
              <div
                key={o.id}
                className="recent-row"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  // SPA navigate to admin invoices tab. Full reload would lose
                  // the dashboard mount + auth context. Pushstate + dispatch a
                  // popstate so AdminDashboard's tab listener picks it up.
                window.history.pushState(null, "", "/admin/invoices");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
              >
                <span className="recent-id" title={o.id}>
                  {o.id.slice(0, 8)}
                </span>
                <span className="recent-email">{o.email}</span>
                <span className={`badge ${o.status}`}>{o.status.replace("_", " ")}</span>
                <span className="recent-amt price">{fmtUsd(o.totalUsd)}</span>
                <span className="muted recent-when">{new Date(o.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .ov { display: flex; flex-direction: column; gap: 16px; }
        .ov-loading { padding: 60px; text-align: center; color: var(--ink-soft); }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
        .stat { padding: 14px 18px; display: flex; flex-direction: column; gap: 3px; }
        .stat span { font-size: .74rem; color: var(--ink-faint); }
        .stat strong { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
        .stat em { font-style: normal; font-size: .76rem; color: var(--ink-soft); }
        .chart-card, .list-card { padding: 16px 18px; }
        .section-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: .9rem; margin-bottom: 12px; }
        .section-title svg { color: var(--brand); }
        .chart-wrap { position: relative; }
        .chart { width: 100%; height: auto; }
        .chart-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
        .chart-empty span { background: var(--surface-2); color: var(--ink-faint); font-size: .82rem; padding: 8px 14px; border-radius: 100px; }
        .chart-x { display: flex; justify-content: space-between; font-size: .72rem; color: var(--ink-faint); margin-top: 4px; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .list-card ol { list-style: none; display: flex; flex-direction: column; gap: 8px; }
        .list-card li { display: flex; justify-content: space-between; font-size: .86rem; gap: 10px; }
        .muted { color: var(--ink-faint); font-size: .84rem; }
        .warn { color: var(--warn, #b25e00); font-weight: 600; }
        .danger { color: var(--price); font-weight: 600; }
        .chart-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .chart-head .section-title { margin-bottom: 0; }
        .chart-title-group { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .metric-chips { display: flex; gap: 2px; background: var(--surface-2); padding: 3px; border-radius: 100px; }
        .metric-chip { background: none; border: none; color: var(--ink-soft); font-family: var(--font-sans); font-weight: 600; font-size: .74rem; padding: 4px 10px; border-radius: 100px; cursor: pointer; transition: background .15s, color .15s; }
        .metric-chip:hover { color: var(--ink); }
        .metric-chip.on { background: var(--surface); color: var(--brand); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
        .range-chips { display: flex; gap: 4px; background: var(--surface-2); padding: 3px; border-radius: 100px; }
        .range-chip { background: none; border: none; color: var(--ink-soft); font-family: var(--font-sans); font-weight: 600; font-size: .78rem; padding: 5px 12px; border-radius: 100px; cursor: pointer; transition: background .15s, color .15s; }
        .range-chip:hover { color: var(--ink); }
        .range-chip.on { background: var(--surface); color: var(--brand); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
        .recent-list { display: flex; flex-direction: column; gap: 4px; }
        .recent-row { display: grid; grid-template-columns: 90px minmax(0,1fr) 96px 80px 150px; gap: 12px; align-items: center; padding: 9px 12px; border-radius: var(--radius-sm); color: var(--ink); font-size: .84rem; transition: background .15s; }
        .recent-row .badge { justify-self: start; }
        .recent-row .recent-amt { justify-self: end; }
        .recent-row .recent-when { justify-self: end; }
        .recent-row:hover { background: var(--surface-2); }
        .recent-id { font-family: monospace; font-size: .78rem; color: var(--ink-faint); }
        .recent-email { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .recent-amt { font-variant-numeric: tabular-nums; }
        .recent-when { font-size: .76rem; }
        .badge { padding: 3px 9px; border-radius: 100px; font-size: .68rem; font-weight: 600; text-transform: capitalize; white-space: nowrap; }
        .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
        .badge.paid, .badge.completed { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.expired, .badge.cancelled { color: var(--ink-faint); background: var(--surface-2); }
        @media (max-width: 680px) { .two-col { grid-template-columns: 1fr; } .recent-row { grid-template-columns: 1fr; gap: 4px; } .recent-when { display: none; } }
      `}</style>
    </div>
  );
};
