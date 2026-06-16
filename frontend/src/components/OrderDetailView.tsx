import type React from "react";
import { useEffect, useState } from "react";
import { api, fmtUsd, goTo404, isAccessDenied, type OrderDetail } from "../lib/api";
import { Icon } from "./Icon";
import { Sk, SkeletonStyles } from "./Skeleton";

export const OrderDetailView: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [o, setO] = useState<OrderDetail | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ok">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .get<OrderDetail>(`/api/orders/${orderId}`)
      .then((d) => {
        setO(d);
        setState("ok");
      })
      .catch((e) => {
        // 404 (order not found) or 401 (not logged in) → land on /404 so an attacker
        // cannot distinguish "doesn't exist" from "someone else's order".
        if (isAccessDenied(e)) {
          goTo404();
          return;
        }
        setErr(e.message);
        setState("error");
      });
  }, [orderId]);

  const wrap = (inner: React.ReactNode) => (
    <main className="container od-page">
      {inner}
      <Styles />
    </main>
  );
  if (state === "loading")
    return wrap(
      <div className="od card">
        <div className="od-head" style={{ alignItems: "center" }}>
          <Sk w={140} h={24} />
          <Sk w={70} h={22} r={100} />
        </div>
        <Sk h={16} style={{ margin: "8px 0" }} />
        <Sk h={16} w="60%" />
        <Sk h={44} r={8} style={{ marginTop: 18 }} />
        <SkeletonStyles />
      </div>,
    );
  if (state === "error") return wrap(<div className="od-state">{err}</div>);

  const done = o?.status === "paid" || o?.status === "completed";
  const payable = ["pending", "awaiting_payment", "underpaid"].includes(o?.status ?? "");
  return wrap(
    <div className="od card">
      <div className="od-head">
        <div>
          <span className="muted">Order</span>
          <h1>{o?.id}</h1>
        </div>
        <span className={`badge ${o?.status}`}>{o?.status}</span>
      </div>
      <div className="od-items">
        {o?.items.map((i, k) => (
          <div key={k} className="od-line">
            <span>
              {i.name} ×{i.quantity}
            </span>
            <span className="price">{fmtUsd(i.priceUsd * i.quantity)}</span>
          </div>
        ))}
      </div>
      <div className="od-total">
        <span className="od-total-label">Total</span>
        <span className="price">
          {fmtUsd(o?.totalUsd ?? 0)} · {o?.ltcAmount} LTC
        </span>
      </div>
      {done && (
        <div className="od-keys">
          <div className="ok">
            <Icon name="check" size={18} /> Delivered keys
          </div>
          <ul>
            {o?.deliveredKeys.map((k, i) => (
              <li key={i}>
                <code>{k.code}</code>
              </li>
            ))}
          </ul>
          <p className="hint">Keep these private — anyone with the code can redeem it.</p>
        </div>
      )}
      {payable && (
        <div
          className="btn"
          style={{ justifyContent: "center", cursor: "pointer" }}
          onClick={() => {
            window.location.href = `/checkout?id=${o?.id}`;
          }}
        >
          Complete payment
        </div>
      )}
    </div>,
  );
};

const Styles: React.FC = () => (
  <style>{`
    .od-page { padding: 36px 20px; max-width: 560px; margin: 0 auto; }
    .od { padding: 24px; }
    .od-state { padding: 50px; text-align: center; color: var(--ink-soft); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .od-state a, .hint a { color: var(--brand); font-weight: 600; }
    .od-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
    .od-head h1 { font-size: 1.3rem; font-variant-numeric: tabular-nums; }
    .muted { font-size: .76rem; color: var(--ink-faint); }
    .od-items { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
    .od-line { display: flex; justify-content: space-between; font-size: .9rem; }
    .od-total { display: flex; flex-direction: column; gap: 4px; padding: 14px 0; border-top: 1px solid var(--line); margin-bottom: 16px; }
    .od-total-label { font-weight: 600; color: var(--ink-soft); font-size: .95rem; }
    .od-total .price { font-size: 1.3rem; font-weight: 700; }
    .od-keys .ok { display: flex; align-items: center; gap: 7px; color: var(--auto,#137333); font-weight: 700; margin-bottom: 12px; }
    .od-keys ul { list-style: none; display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .od-keys code { display: block; background: #0f172a; color: #a5f3fc; padding: 11px 14px; border-radius: var(--radius-sm); font-size: .9rem; word-break: break-all; }
    .hint { font-size: .8rem; color: var(--ink-faint); }
    .badge { padding: 4px 11px; border-radius: 100px; font-size: .74rem; font-weight: 600; }
    .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
    .badge.paid, .badge.completed { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
    .badge.expired, .badge.cancelled { color: var(--price); background: var(--price-soft); }
  `}</style>
);
