import type React from "react";
import { useEffect, useState } from "react";
import { ApiRequestError, api, fmtUsd, type OrderSummary } from "../lib/api";
import { Icon } from "./Icon";
import { SkeletonStyles, SkRows } from "./Skeleton";

const label: Record<string, string> = {
  pending: "Awaiting payment",
  awaiting_payment: "Awaiting payment",
  underpaid: "Underpaid",
  paid: "Paid",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const MyOrders: React.FC = () => {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OrderSummary[]>("/api/orders")
      .then(setOrders)
      .catch((e) => {
        if (e instanceof ApiRequestError && e.status === 401) setNeedLogin(true);
        else setErr(e.message);
      });
  }, []);

  if (needLogin)
    return (
      <main className="container ord-page">
        <div className="ord-state">
          Please <a href="/login?redirect=/orders">sign in</a> to view your orders.
        </div>
        <Styles />
      </main>
    );
  if (err)
    return (
      <main className="container ord-page">
        <div className="ord-state">{err}</div>
        <Styles />
      </main>
    );
  if (!orders)
    return (
      <main className="container ord-page">
        <h1>My Orders</h1>
        <SkRows count={4} height={92} />
        <SkeletonStyles />
        <Styles />
      </main>
    );

  return (
    <main className="container ord-page">
      <h1>My Orders</h1>
      {orders.length === 0 ? (
        <div className="ord-empty card">
          <span className="ord-empty-icon">
            <Icon name="receipt" size={28} variant="badge" />
          </span>
          <h2>No orders yet</h2>
          <p>Once you complete a purchase, your keys and order history will live here forever.</p>
          <a className="btn" href="/">
            <Icon name="cart" size={16} variant="duotone-regular" /> Start shopping
          </a>
        </div>
      ) : (
        <div className="ord-list">
          {orders.map((o) => (
            <a key={o.id} className="ord card" href={`/orders/${o.id}`}>
              <div className="ord-top">
                <strong>{o.id}</strong>
                <span className={`badge ${o.status}`}>{label[o.status] ?? o.status}</span>
              </div>
              <div className="ord-items">
                {o.items.map((i, k) => (
                  <span key={k} className="pill">
                    {i.name} ×{i.quantity}
                  </span>
                ))}
              </div>
              <div className="ord-bottom">
                <span className="muted">{new Date(o.createdAt).toLocaleString()}</span>
                <span className="price">
                  {fmtUsd(o.totalUsd)} · {o.ltcAmount} LTC
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
      <Styles />
    </main>
  );
};

const Styles: React.FC = () => (
  <style>{`
    .ord-page { width: 100%; padding: 36px 20px; max-width: 720px; margin: 0 auto; }
    .ord-page h1 { font-size: 1.5rem; margin-bottom: 20px; }
    .ord-state { padding: 50px 20px; text-align: center; color: var(--ink-soft); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .ord-state a { color: var(--brand); font-weight: 600; }
    .ord-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 24px; text-align: center; }
    .ord-empty h2 { font-size: 1.2rem; font-weight: 700; color: var(--ink); }
    .ord-empty p { color: var(--ink-soft); font-size: .9rem; max-width: 360px; line-height: 1.5; }
    .ord-empty .btn { margin-top: 6px; }
    .ord-list { display: flex; flex-direction: column; gap: 12px; }
    .ord { display: block; padding: 16px 18px; color: inherit; }
    .ord:hover { box-shadow: var(--shadow-hover); }
    .ord-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .ord-top strong { font-variant-numeric: tabular-nums; }
    .ord-items { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .ord-bottom { display: flex; justify-content: space-between; align-items: baseline; }
    .muted { font-size: .8rem; color: var(--ink-faint); }
    .badge { padding: 4px 11px; border-radius: 100px; font-size: .74rem; font-weight: 600; }
    .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
    .badge.paid, .badge.completed { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
    .badge.expired, .badge.cancelled { color: var(--price); background: var(--price-soft); }
  `}</style>
);
