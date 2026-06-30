import type React from "react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api, fmtUsd, type OrderSummary } from "../lib/api";
import { useAuthOptional } from "./AuthContext";
import { Icon } from "./Icon";
import { SkeletonStyles, SkRows } from "./Skeleton";

export const MyOrders: React.FC = () => {
  const { t } = useT();
  // Gate the /api/orders call on hydrated auth state so a guest browsing
  // /orders directly never triggers a 401 in the console. Falls back to
  // optimistic fetch (legacy behaviour) if AuthProvider isn't mounted.
  const auth = useAuthOptional();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label: Record<string, string> = {
    pending: t("storefront.checkout.awaitingPayment"),
    awaiting_payment: t("storefront.checkout.awaitingPayment"),
    underpaid: t("storefront.checkout.underpaid"),
    paid: t("storefront.checkout.paid"),
    completed: t("storefront.checkout.completed"),
    expired: t("storefront.checkout.expired"),
    cancelled: t("storefront.checkout.cancelled"),
  };

  useEffect(() => {
    // Wait until auth context resolves. Skip the fetch entirely when the
    // user is known to be logged out — show the login prompt instead.
    if (auth) {
      if (auth.loading) return;
      if (!auth.user) {
        setNeedLogin(true);
        return;
      }
    }
    api
      .get<OrderSummary[]>("/api/orders")
      .then(setOrders)
      .catch((e) => {
        if (e instanceof ApiRequestError && e.status === 401) setNeedLogin(true);
        else setErr(e.message);
      });
  }, [auth?.user?.id, auth?.loading]);

  if (needLogin)
    return (
      <main className="container ord-page">
        <div className="ord-state">
          {t("storefront.orders.pleaseSignInPrefix")}{" "}
          <span
            style={{ cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}
            onClick={() => {
              window.location.href = "/login?redirect=/orders";
            }}
          >
            {t("storefront.auth.signIn").toLowerCase()}
          </span>{" "}
          {t("storefront.orders.pleaseSignInSuffix")}
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
        <h1>{t("storefront.account.myOrders")}</h1>
        <SkRows count={4} height={92} />
        <SkeletonStyles />
        <Styles />
      </main>
    );

  return (
    <main className="container ord-page">
      <h1>{t("storefront.account.myOrders")}</h1>
      {orders.length === 0 ? (
        <div className="ord-empty card">
          <span className="ord-empty-icon">
            <Icon name="receipt" size={28} variant="badge" />
          </span>
          <h2>{t("storefront.orders.emptyTitle")}</h2>
          <p>{t("storefront.orders.emptyHint")}</p>
          <div
            className="btn"
            style={{ cursor: "pointer" }}
            onClick={() => {
              window.location.href = "/";
            }}
          >
            <Icon name="cart" size={16} variant="duotone-regular" />{" "}
            {t("storefront.orders.startShopping")}
          </div>
        </div>
      ) : (
        <div className="ord-list">
          {orders.map((o) => (
            <div
              key={o.id}
              className="ord card"
              style={{ cursor: "pointer" }}
              onClick={() => {
                window.location.href = `/orders/${o.id}`;
              }}
            >
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
            </div>
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