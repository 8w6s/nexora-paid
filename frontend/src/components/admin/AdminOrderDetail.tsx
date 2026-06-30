import type React from "react";
import { useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { useToast } from "../Toast";

interface OrderDetail {
  id: string;
  status: string;
  email: string;
  totalUsd: number;
  ltcAmount: string;
  ltcRate: number;
  rateSource: string;
  ltcAddress: string;
  expectedLitoshi: number;
  receivedLitoshi: number;
  confirmations: number;
  paidTxId: string | null;
  createdAt: number;
  paidAt: number | null;
  deliveredAt: number | null;
  expiresAt: number | null;
  items: { id: string; productId: string; name: string; quantity: number; priceUsd: number }[];
  keys: { id: string; productId: string; code: string; status: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting payment",
  awaiting_payment: "Awaiting payment",
  underpaid: "Underpaid",
  paid: "Paid",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const AdminOrderDetail: React.FC<{ orderId: string; onBack: () => void }> = ({
  orderId,
  onBack,
}) => {
  const [o, setO] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // Switching between orders fast (eg. clicking through the list)
    // would otherwise let the previous fetch race the new one and stomp
    // state with stale data. Drop the result if the component unmounted
    // or the orderId already changed.
    let alive = true;
    api
      .get<OrderDetail>(`/api/admin/orders/${orderId}`)
      .then((d) => {
        if (alive) setO(d);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      alive = false;
    };
  }, [orderId]);

  const resendEmail = async () => {
    setResending(true);
    try {
      await api.post(`/api/admin/orders/${orderId}/resend-email`, {});
      toast.success("Email resent successfully!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resend email");
    } finally {
      setResending(false);
    }
  };

  if (err)
    return (
      <div className="aod">
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrow-right" size={14} className="flip" /> Back
        </button>
        <div className="err">{err}</div>
      </div>
    );
  if (!o)
    return (
      <div className="aod">
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrow-right" size={14} className="flip" /> Back
        </button>
        <EmptyState icon="spinner" title="Loading…" compact />
      </div>
    );

  const subtotal = o.items.reduce((s, i) => s + i.priceUsd * i.quantity, 0);

  return (
    <div className="aod">
      <header className="aod-head">
        <div>
          <button className="btn btn-ghost" onClick={onBack} type="button">
            <Icon name="arrow-right" size={14} className="flip" /> Back to invoices
          </button>
          <h1>
            Invoice <span className="mono">{o.id}</span>
          </h1>
          <p className="muted">Created {new Date(o.createdAt).toLocaleString()}</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {(o.status === "paid" || o.status === "completed") && (
            <button
              className="btn btn-outline"
              onClick={resendEmail}
              disabled={resending}
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                fontSize: "0.85rem",
                height: "34px",
              }}
            >
              <Icon
                name={resending ? "spinner" : "envelope"}
                size={14}
                className={resending ? "spin" : ""}
              />
              {resending ? "Resending..." : "Resend Email"}
            </button>
          )}
          <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
        </div>
      </header>

      <div className="aod-grid">
        <section className="card aod-pane">
          <h3>
            <Icon name="box" size={16} variant="badge" /> Items
          </h3>
          <table className="aod-items">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Unit</th>
                <th className="num">Line</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{fmtUsd(i.priceUsd)}</td>
                  <td className="num">{fmtUsd(i.priceUsd * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="num muted">
                  Subtotal
                </td>
                <td className="num">{fmtUsd(subtotal)}</td>
              </tr>
              {subtotal !== o.totalUsd && (
                <tr>
                  <td colSpan={3} className="num muted">
                    Discount
                  </td>
                  <td className="num">−{fmtUsd(subtotal - o.totalUsd)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="num">
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong className="price">{fmtUsd(o.totalUsd)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>

          <h3 className="sub">
            <Icon name="key" size={16} variant="badge" /> Delivered keys
          </h3>
          {o.keys.length === 0 ? (
            <EmptyState
              icon="key"
              title="No keys delivered yet"
              desc={
                o.status === "paid" || o.status === "completed"
                  ? "Order is paid but no keys were assigned. May be a service or dynamic delivery product."
                  : "Keys will appear here once the order is paid and confirmed."
              }
              compact
            />
          ) : (
            <ul className="aod-keys">
              {o.keys.map((k) => (
                <li key={k.id}>
                  <code>{k.code}</code>
                  <span className="muted">{k.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card aod-pane aod-side">
          <h3>
            <Icon name="bell" size={16} variant="badge" /> Customer
          </h3>
          <div className="kv-row">
            <span>Email</span>
            <strong>{o.email}</strong>
          </div>

          <h3 className="sub">
            <Icon name="receipt" size={16} variant="badge" /> Payment
          </h3>
          <div className="kv-row">
            <span>Method</span>
            <strong>Litecoin</strong>
          </div>
          <div className="kv-row">
            <span>Amount</span>
            <strong>{o.ltcAmount} LTC</strong>
          </div>
          <div className="kv-row">
            <span>Rate</span>
            <strong>
              ${o.ltcRate?.toFixed?.(2) ?? "—"}/LTC <em>({o.rateSource})</em>
            </strong>
          </div>
          <div className="kv-row">
            <span>Address</span>
            <code className="addr">{o.ltcAddress}</code>
          </div>
          <div className="kv-row">
            <span>Received</span>
            <strong>{(o.receivedLitoshi / 1e8).toFixed(8)} LTC</strong>
          </div>
          <div className="kv-row">
            <span>Confirmations</span>
            <strong>{o.confirmations}</strong>
          </div>
          {o.paidTxId && (
            <div className="kv-row">
              <span>TX</span>
              <code className="addr">{o.paidTxId}</code>
            </div>
          )}

          <h3 className="sub">
            <Icon name="zap" size={16} variant="badge" /> Timeline
          </h3>
          <ul className="aod-timeline">
            <li>
              <span className="dot ok" />
              <div>
                <strong>Created</strong>
                <span>{new Date(o.createdAt).toLocaleString()}</span>
              </div>
            </li>
            {o.paidAt && (
              <li>
                <span className="dot ok" />
                <div>
                  <strong>Paid</strong>
                  <span>{new Date(o.paidAt).toLocaleString()}</span>
                </div>
              </li>
            )}
            {o.deliveredAt && (
              <li>
                <span className="dot ok" />
                <div>
                  <strong>Delivered</strong>
                  <span>{new Date(o.deliveredAt).toLocaleString()}</span>
                </div>
              </li>
            )}
            {o.expiresAt && !o.paidAt && (
              <li>
                <span className="dot warn" />
                <div>
                  <strong>Expires</strong>
                  <span>{new Date(o.expiresAt).toLocaleString()}</span>
                </div>
              </li>
            )}
          </ul>
        </aside>
      </div>

      <style>{`
        .aod { display: flex; flex-direction: column; gap: 18px; }
        .aod-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
        .aod-head h1 { font-size: 1.4rem; font-weight: 700; color: var(--ink); margin: 6px 0 2px; }
        .aod-head .mono { font-family: monospace; font-size: 1.05rem; }
        .aod-head .muted { color: var(--ink-faint); font-size: .82rem; }
        .aod-grid { display: grid; grid-template-columns: 1fr 340px; gap: 16px; align-items: start; }
        .aod-pane { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
        .aod-pane h3 { display: flex; align-items: center; gap: 10px; font-size: 1rem; font-weight: 700; color: var(--ink); }
        .aod-pane h3.sub { padding-top: 14px; border-top: 1px solid var(--line); margin-top: 4px; }
        .aod-items { width: 100%; border-collapse: collapse; }
        .aod-items th, .aod-items td { padding: 9px 10px; border-bottom: 1px solid var(--line); font-size: .88rem; }
        .aod-items th { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); text-align: left; background: var(--surface-2); }
        .aod-items tfoot td { border-bottom: none; padding-top: 12px; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { color: var(--ink-soft); }
        .aod-keys { list-style: none; display: flex; flex-direction: column; gap: 6px; }
        .aod-keys li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; background: var(--surface-2); border-radius: var(--radius-sm); }
        .aod-keys code { font-family: monospace; font-size: .85rem; color: var(--ink); word-break: break-all; }
        .aod-side .kv-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: .85rem; color: var(--ink-soft); padding: 4px 0; }
        .aod-side .kv-row strong { color: var(--ink); font-weight: 600; text-align: right; }
        .aod-side .kv-row em { font-style: normal; color: var(--ink-faint); }
        .aod-side .addr { font-family: monospace; font-size: .76rem; color: var(--ink); word-break: break-all; text-align: right; max-width: 200px; }
        .aod-timeline { list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .aod-timeline li { display: flex; gap: 12px; align-items: flex-start; }
        .aod-timeline .dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; background: var(--ink-faint); }
        .aod-timeline .dot.ok { background: var(--auto, #16a34a); }
        .aod-timeline .dot.warn { background: var(--warn, #d97706); }
        .aod-timeline strong { display: block; font-size: .86rem; color: var(--ink); }
        .aod-timeline span { display: block; font-size: .78rem; color: var(--ink-faint); }
        .badge { padding: 5px 12px; border-radius: 100px; font-size: .76rem; font-weight: 600; white-space: nowrap; }
        .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
        .badge.paid, .badge.completed { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.expired, .badge.cancelled { color: var(--ink-faint); background: var(--surface-2); }
        .err { background: var(--price-soft); color: var(--price); padding: 9px 12px; border-radius: var(--radius-sm); font-size: .84rem; }
        .btn-ghost .flip { transform: rotate(180deg); }
        @media (max-width: 880px) { .aod-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};
