import React, { useEffect, useState } from "react";
import { useCart } from "./CartContext";
import { Icon } from "./Icon";
import { api, ApiRequestError, fmtUsd, isAccessDenied, goTo404, type OrderDetail, type OrderStatus, type CheckoutResult } from "../lib/api";
import { Sk, SkeletonStyles } from "./Skeleton";
import { useAuth } from "./AuthContext";
import { Dropdown } from "./Dropdown";

function useLdrs() {
  useEffect(() => {
    import("ldrs").then(({ chaoticOrbit, cardio }) => { chaoticOrbit.register(); cardio.register(); });
  }, []);
}

function useOrderQuery(): { id: string | null; token: string | null } {
  const [query, setQuery] = useState({ id: null as string | null, token: null as string | null });
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setQuery({ id: sp.get("id"), token: sp.get("token") });
  }, []);
  return query;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Litecoin block time averages ~2.5 min; used to translate "remaining confirmations" into a human ETA.
const LTC_BLOCK_MIN = 2.5;
const STEPS = [
  { key: "sent", label: "Sent" },
  { key: "seen", label: "Seen" },
  { key: "confirming", label: "Confirming" },
  { key: "delivered", label: "Delivered" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

function activeStep(st: OrderStatus | null, status: string): StepKey {
  if (status === "paid" || status === "completed") return "delivered";
  if (!st) return "sent";
  const required = st.requiredConfirmations || 2;
  const current = Math.max(0, st.confirmations || 0);
  const received = st.receivedLitoshi || 0;
  if (current >= required) return "delivered";
  if (current > 0) return "confirming";
  if (received > 0) return "seen";
  return "sent";
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const label: Record<string, string> = { pending: "Awaiting payment", awaiting_payment: "Awaiting payment", underpaid: "Underpaid", paid: "Paid", completed: "Completed", expired: "Expired", cancelled: "Cancelled" };
  const waiting = status === "pending" || status === "awaiting_payment" || status === "underpaid";
  return <span className={`badge ${status}`}>{waiting && <l-cardio size="14" stroke="2" speed="2" color="currentColor"></l-cardio>}{label[status] ?? status}</span>;
};

const CopyBtn: React.FC<{ value: string; label?: string; small?: boolean }> = ({ value, label, small }) => {
  const [flash, setFlash] = useState(false);
  const onClick = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setFlash(true);
      setTimeout(() => setFlash(false), 1400);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`copy-btn ${flash ? "is-flash" : ""} ${small ? "sm" : ""}`}
      aria-label={flash ? "Copied" : (label ?? "Copy")}
      title={flash ? "Copied!" : (label ?? "Copy")}
    >
      <Icon name={flash ? "check" : "copy"} size={small ? 14 : 16} />
      {label && <span>{flash ? "Copied" : label}</span>}
    </button>
  );
};

const PayView: React.FC<{ orderId: string; token: string | null }> = ({ orderId, token }) => {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [st, setSt] = useState<OrderStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { user } = useAuth();
  // Guest = no logged-in session AND order is reached via the URL token, not a
  // real account session. We surface a stronger "save this link" warning for
  // them because they have no /orders page to return to.
  const isGuest = !user && !!token;
  useLdrs();

  useEffect(() => {
    let alive = true;
    const queryStr = token ? `?token=${token}` : "";
    api.get<OrderDetail>(`/api/orders/${orderId}${queryStr}`)
      .then((d) => alive && setDetail(d))
      .catch((e) => {
        if (!alive) return;
        if (isAccessDenied(e)) { goTo404(); return; }
        setErr(e.message);
      });
    const poll = async () => {
      try {
        const s = await api.get<OrderStatus>(`/api/orders/${orderId}/status${queryStr}`);
        if (!alive) return;
        setSt(s);
        if (s.status === "paid" || s.status === "completed") {
          const d = await api.get<OrderDetail>(`/api/orders/${orderId}${queryStr}`);
          if (alive) setDetail(d);
        }
      } catch (e) {
        if (alive && isAccessDenied(e)) goTo404();
      }
    };
    poll();
    // Poll every 5s while the tab is visible — pause when backgrounded so an
    // abandoned checkout tab doesn't burn requests for the full payment window.
    // On visibility return, fire one immediate poll so the badge catches up.
    const t = setInterval(() => { if (!document.hidden) poll(); }, 5000);
    const onVis = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [orderId, token]);

  if (err) return <div className="co-state">{err}</div>;
  if (!detail) return (
    <div className="pay card">
      <div className="pay-head"><div><Sk w={50} h={11} /><Sk w={130} h={22} style={{ marginTop: 6 }} /></div><Sk w={80} h={22} r={100} /></div>
      <Sk h={14} style={{ margin: "16px 0" }} /><Sk h={14} w="70%" style={{ marginBottom: 16 }} />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Sk w={220} h={220} r={8} /></div>
      <Sk h={42} r={8} style={{ marginBottom: 18 }} />
      <SkeletonStyles />
      <CheckoutStyles />
    </div>
  );

  const status = st?.status ?? detail.status;
  const done = status === "paid" || status === "completed";
  const expired = status === "expired" || status === "cancelled";

  return (
    <div className="pay card">
      <div className="pay-head">
        <div><span className="muted">Order</span><h1>{detail.id}</h1></div>
        <StatusBadge status={status} />
      </div>

      {done ? (
        <div className="delivered">
          <div className="ok-banner">
            <span className="ok-ico"><Icon name="check" size={20} /></span>
            <div>
              <strong>Payment confirmed</strong>
              <span>Your {detail.deliveredKeys.length > 1 ? "keys are" : "key is"} ready. Copy and store {detail.deliveredKeys.length > 1 ? "them" : "it"} somewhere safe.</span>
            </div>
          </div>
          <ul className="keys">
            {detail.deliveredKeys.map((k, i) => (
              <li key={i}>
                <span className="k-idx">#{i + 1}</span>
                <code>{k.code}</code>
                <CopyBtn value={k.code} small />
              </li>
            ))}
          </ul>
          {isGuest ? (
            <>
              <div className="warn-guest">
                <Icon name="shield" size={16} />
                <div>
                  <strong>Bookmark this page</strong>
                  <span>You ordered as a guest — there is no account to log back into. Save this URL or copy your key{detail.deliveredKeys.length > 1 ? "s" : ""} now; once you close this tab the page can only be reached via this exact link.</span>
                </div>
              </div>
              <p className="hint"><Icon name="key" size={14} /> Want one-click access next time? <a href="/register">Create an account</a> with the same email to attach this order to your history.</p>
            </>
          ) : (
            <p className="hint"><Icon name="shield" size={14} /> Keep these private — anyone with the code can redeem it. You can always find them in <a href="/orders">My Orders</a>.</p>
          )}
        </div>
      ) : expired ? (
        <div className="co-state">This order has {status}. <a href="/">Back to shop</a></div>
      ) : (
        <>
          <p className="instructions">Send exactly <strong>{detail.ltcAmount} LTC</strong> to the address below. Your keys are delivered automatically after {st?.requiredConfirmations ?? 2} confirmations.</p>
          <div className="qr-wrap">
            <div className="qr"><img src={detail.qrCodeUrl} alt="Litecoin payment QR" width={220} height={220} /></div>
            <span className="qr-chip"><Icon name="bolt" size={12} /> Scan to pay</span>
          </div>
          <div className="field">
            <label>Address</label>
            <div className="field-row">
              <code className="addr">{detail.ltcAddress}</code>
              <CopyBtn value={detail.ltcAddress} label="Copy" />
            </div>
          </div>
          <div className="field">
            <label>Amount</label>
            <div className="field-row">
              <code className="addr">{detail.ltcAmount} LTC</code>
              <CopyBtn value={detail.ltcAmount} label="Copy" />
            </div>
          </div>
          {(() => {
            const step = activeStep(st, status);
            const stepIdx = STEPS.findIndex((s) => s.key === step);
            const required = st?.requiredConfirmations ?? 2;
            const current = Math.min(Math.max(0, st?.confirmations ?? 0), required);
            const remaining = Math.max(0, required - current);
            const etaText = remaining === 0 ? "any moment" : `~${Math.ceil(remaining * LTC_BLOCK_MIN)} min`;
            return (
              <div className="conf-stepper" role="progressbar" aria-valuenow={stepIdx + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
                {STEPS.map((s, idx) => {
                  const isActive = idx === stepIdx;
                  const isDone = idx < stepIdx;
                  return (
                    <div key={s.key} className={`cs-step${isActive ? " on" : ""}${isDone ? " done" : ""}`}>
                      <span className="cs-dot">{isDone ? <Icon name="check" size={12} /> : <span className="cs-num">{idx + 1}</span>}</span>
                      <span className="cs-label">
                        {s.label}
                        {isActive && s.key === "confirming" && <em className="cs-meta">{current}/{required} · {etaText}</em>}
                        {isActive && s.key === "seen" && <em className="cs-meta">on chain</em>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="pay-meta">
            <div><span>Total</span><strong>{fmtUsd(detail.totalUsd)}</strong></div>
            <div><span>Expires in</span><strong className="mono">{st ? mmss(st.expiresInSec) : "—"}</strong></div>
          </div>
          {status === "underpaid" && <div className="warn">Amount received is short. Send the remainder to the same address.</div>}
          <p className="hint"><l-chaotic-orbit size="16" speed="1.5" color="currentColor"></l-chaotic-orbit> Waiting for payment on the Litecoin network… this page updates automatically.</p>
        </>
      )}
      <CheckoutStyles />
    </div>
  );
};

interface PayMethod { id: string; label: string; kind: string; }
const KIND_ICON: Record<string, string> = {
  "crypto-native": "key", "crypto-gateway": "key", card: "receipt", wallet: "box", manual: "box",
};

const COUNTRIES = [
  { code: "VN", name: "Vietnam" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Japan" },
  { code: "SG", name: "Singapore" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "IE", name: "Ireland" },
];

const ReviewView: React.FC = () => {
  const { cart, getCartTotal, clearCart } = useCart();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [methods, setMethods] = useState<PayMethod[] | null>(null);
  const [method, setMethod] = useState<string>("");
  const [coupon, setCoupon] = useState("");
  const [email, setEmail] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string>("VN");
  useLdrs();

  useEffect(() => {
    setMethods(null);
    api.get<{ methods: PayMethod[] }>(`/api/payments?country=${selectedCountry}`)
      .then((d) => {
        setMethods(d.methods);
        if (d.methods.length > 0) {
          if (!d.methods.some((m) => m.id === method)) {
            setMethod(d.methods[0].id);
          }
        } else {
          setMethod("");
        }
      })
      .catch(() => {
        setMethods([]);
        setMethod("");
      });
  }, [selectedCountry]);

  const pay = async () => {
    setErr(null); setBusy(true);
    try {
      if (!user && !email.trim()) {
        setErr("Please enter your email to receive items");
        setBusy(false);
        return;
      }
      const res = await api.post<CheckoutResult & { orderToken?: string }>("/api/checkout", {
        items: cart.map((c) => ({ productId: c.product.id, qty: c.quantity })),
        method,
        coupon: coupon.trim() || undefined,
        email: !user ? email.trim() : undefined,
      });
      clearCart();
      const tokenQuery = res.orderToken ? `&token=${res.orderToken}` : "";
      window.location.assign(`/checkout?id=${res.orderId}${tokenQuery}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checkout failed");
      setBusy(false);
    }
  };

  if (cart.length === 0) return <div className="co-state">Your cart is empty. <a href="/">Browse products</a></div>;

  return (
    <div className="review card">
      <h1>Checkout</h1>
      <div className="lines">
        {cart.map((c) => (
          <div key={c.product.id} className="line">
            <img src={c.product.image} alt={c.product.name} />
            <div className="ln-name"><strong>{c.product.name}</strong><span>{fmtUsd(c.product.priceUsd)} × {c.quantity}</span></div>
            <span className="ln-total price">{fmtUsd(c.product.priceUsd * c.quantity)}</span>
          </div>
        ))}
      </div>
      
      <div className="field" style={{ margin: "20px 0" }}>
        <label>Your Country (for payment routing)</label>
        <Dropdown<string>
          value={selectedCountry}
          onChange={(v) => setSelectedCountry(v)}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
          width="100%"
        />
      </div>

      {!user && (
        <div className="field" style={{ margin: "20px 0" }}>
          <label>Your Email (to receive delivery keys)</label>
          <div className="field-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              style={{ flex: 1, border: "none", background: "none", outline: "none", padding: "11px 13px", fontSize: "0.9rem", color: "var(--ink)" }}
              required
            />
          </div>
        </div>
      )}

      <div className="coupon-row">
        <Icon name="zap" size={15} />
        <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code (optional)" aria-label="Coupon code" />
      </div>
      <div className="grand"><span>Total</span><span className="price">{fmtUsd(getCartTotal())}</span></div>

      <div className="pay-methods">
        <span className="pm-label">Payment method</span>
        {methods === null ? (
          <div className="pm-loading"><Icon name="spinner" size={18} /> Loading methods…</div>
        ) : methods.length === 0 ? (
          <div className="warn">No payment method available. The store owner hasn't enabled one yet.</div>
        ) : (
          <div className="pm-list">
            {methods.map((m) => (
              <button key={m.id} className={`pm ${method === m.id ? "on" : ""}`} onClick={() => setMethod(m.id)} type="button">
                <Icon name={(KIND_ICON[m.kind] ?? "key") as any} size={18} variant="badge" />
                <span className="pm-name">{m.label}</span>
                <span className={`pm-radio ${method === m.id ? "on" : ""}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="warn">{err}</div>}
      <button className="btn" onClick={pay} disabled={busy || !method} style={{ width: "100%", justifyContent: "center" }}>
        {busy ? <><l-chaotic-orbit size="20" speed="1.5" color="currentColor"></l-chaotic-orbit><span>Creating order…</span></> : <><Icon name="key" size={16} /><span>Continue to payment</span></>}
      </button>
      <p className="hint">You'll get payment details on the next step. Keys are delivered automatically after confirmation.</p>
      <CheckoutStyles />
    </div>
  );
};

export const Checkout: React.FC = () => {
  const { id, token } = useOrderQuery();
  return <main className="container co-page">{id ? <PayView orderId={id} token={token} /> : <ReviewView />}</main>;
};

const CheckoutStyles: React.FC = () => (
  <style>{`
    .co-page { padding: 40px 20px; display: flex; justify-content: center; }
    .pay, .review { width: 100%; max-width: 540px; padding: 28px; }
    .co-state { padding: 60px 20px; text-align: center; color: var(--ink-soft); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .co-state a, .hint a, .delivered a { color: var(--brand); font-weight: 600; }
    .pay-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
    .pay-head h1 { font-size: 1.35rem; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
    .muted { font-size: .74rem; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
    .mono { font-variant-numeric: tabular-nums; }
    .instructions { font-size: .92rem; color: var(--ink-soft); line-height: 1.55; margin: 14px 0 20px; }
    .instructions strong { color: var(--ink); font-weight: 700; }

    /* QR with a small floating chip label */
    .qr-wrap { position: relative; display: flex; justify-content: center; margin-bottom: 22px; }
    .qr { padding: 10px; background: #fff; border-radius: 14px; box-shadow: var(--shadow), 0 0 0 1px var(--line); }
    .qr img { display: block; border-radius: 6px; }
    .qr-chip { position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 5px; font-size: .7rem; font-weight: 700; padding: 5px 11px; border-radius: 100px; background: var(--brand); color: #fff; text-transform: uppercase; letter-spacing: .07em; box-shadow: 0 4px 12px rgba(79,70,229,.35); }

    /* Field = labelled row with monospace value + copy button on the right */
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: .72rem; font-weight: 700; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
    .field-row { display: flex; align-items: stretch; gap: 0; border: 1px solid var(--line-strong); border-radius: 10px; overflow: hidden; background: var(--surface-2); transition: border-color .15s; }
    .field-row:focus-within, .field-row:hover { border-color: var(--brand); }
    .field-row .addr { flex: 1; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .85rem; padding: 11px 13px; word-break: break-all; background: none; line-height: 1.4; display: flex; align-items: center; }

    /* Reusable copy button. .sm = compact icon-only variant for keys list. */
    .copy-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 14px; border: none; border-left: 1px solid var(--line-strong); background: var(--surface); color: var(--ink-soft); font-family: var(--font-sans); font-weight: 600; font-size: .82rem; cursor: pointer; transition: background .15s, color .15s; line-height: 1; }
    .copy-btn:hover { background: var(--brand-soft, rgba(79,70,229,.08)); color: var(--brand); }
    .copy-btn:active { transform: scale(.97); }
    .copy-btn.is-flash { color: var(--auto, #137333); background: var(--auto-soft, #e6f4ea); }
    .copy-btn.sm { width: 38px; height: 38px; padding: 0; border-left: none; border-radius: 10px; background: rgba(255,255,255,.06); color: #a5f3fc; flex-shrink: 0; }
    .copy-btn.sm:hover { background: rgba(165,243,252,.18); color: #fff; }
    .copy-btn.sm.is-flash { background: rgba(16,185,129,.22); color: #6ee7b7; }

    /* Confirmation stepper — 4 steps Sent → Seen → Confirming(n/N · ETA) → Delivered.
       Replaces the raw "Confirmations 280693/2" number which overflowed visually when
       a stale order's tx kept gaining blockchain depth past the required threshold. */
    .conf-stepper { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 16px 0 14px; padding: 12px 10px; background: var(--surface-2); border-radius: 12px; position: relative; }
    .conf-stepper::before { content: ""; position: absolute; top: 24px; left: 12.5%; right: 12.5%; height: 2px; background: var(--line-strong); z-index: 0; }
    .cs-step { display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; z-index: 1; }
    .cs-dot { width: 26px; height: 26px; border-radius: 50%; background: var(--surface); border: 2px solid var(--line-strong); display: flex; align-items: center; justify-content: center; color: var(--ink-faint); font-weight: 700; font-size: .72rem; transition: background .25s, border-color .25s, color .25s, transform .25s; }
    .cs-step.on .cs-dot { background: var(--brand); border-color: var(--brand); color: #fff; transform: scale(1.12); box-shadow: 0 0 0 6px rgba(79,70,229,.18); }
    .cs-step.done .cs-dot { background: var(--auto, #137333); border-color: var(--auto, #137333); color: #fff; }
    .cs-num { display: inline-block; line-height: 1; }
    .cs-label { font-size: .72rem; font-weight: 600; color: var(--ink-faint); text-align: center; letter-spacing: .02em; display: flex; flex-direction: column; gap: 2px; line-height: 1.3; }
    .cs-step.on .cs-label { color: var(--ink); }
    .cs-step.done .cs-label { color: var(--ink-soft); }
    .cs-meta { font-style: normal; font-size: .66rem; font-weight: 500; color: var(--brand); font-variant-numeric: tabular-nums; letter-spacing: .03em; }
    @keyframes cs-pulse { 0%, 100% { box-shadow: 0 0 0 6px rgba(79,70,229,.18); } 50% { box-shadow: 0 0 0 10px rgba(79,70,229,.06); } }
    .cs-step.on .cs-dot { animation: cs-pulse 1.8s ease-in-out infinite; }

    /* Pay meta strip — totals & timers (now 2-col since stepper owns the progress UX) */
    .pay-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 0 0 18px; padding: 14px; background: var(--surface-2); border-radius: 10px; }
    .pay-meta > div { display: flex; flex-direction: column; gap: 3px; text-align: center; }
    .pay-meta span { font-size: .68rem; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
    .pay-meta strong { font-size: 1rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }

    .hint { font-size: .82rem; color: var(--ink-faint); display: flex; align-items: center; gap: 7px; line-height: 1.55; }
    .warn { background: var(--warn-soft, #fff4e5); color: var(--warn, #b25e00); padding: 10px 13px; border-radius: var(--radius-sm); font-size: .84rem; margin-bottom: 14px; }

    /* Guest delivery warning — shown to anonymous buyers who reached the
       paid view via the URL token. They have no /orders to return to so we
       lean hard on "bookmark/copy now". */
    .warn-guest { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; margin: 16px 0 14px; background: linear-gradient(135deg, rgba(245,34,45,.10), rgba(245,158,11,.08)); border: 1px solid rgba(245,34,45,.28); border-radius: 12px; }
    .warn-guest > svg, .warn-guest > .svg-inline--fa { color: var(--warn, #b25e00); flex-shrink: 0; margin-top: 2px; }
    .warn-guest div { display: flex; flex-direction: column; gap: 3px; }
    .warn-guest strong { font-size: .92rem; font-weight: 700; color: var(--ink); }
    .warn-guest span { font-size: .82rem; color: var(--ink-soft); line-height: 1.5; }

    /* Delivered keys (paid/completed state) */
    .ok-banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: linear-gradient(135deg, rgba(16,185,129,.12), rgba(79,70,229,.08)); border: 1px solid rgba(16,185,129,.3); border-radius: 12px; margin-bottom: 18px; }
    .ok-banner .ok-ico { width: 38px; height: 38px; border-radius: 50%; background: var(--auto, #137333); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ok-banner div { display: flex; flex-direction: column; gap: 2px; }
    .ok-banner strong { font-size: 1rem; font-weight: 700; color: var(--ink); }
    .ok-banner span { font-size: .85rem; color: var(--ink-soft); line-height: 1.45; }
    .keys { list-style: none; display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
    .keys li { display: flex; align-items: center; gap: 10px; background: #0f172a; padding: 8px 8px 8px 14px; border-radius: 10px; transition: transform .12s; }
    .keys li:hover { transform: translateY(-1px); }
    .keys .k-idx { font-size: .68rem; font-weight: 700; color: #64748b; font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .keys code { flex: 1; color: #a5f3fc; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .88rem; letter-spacing: .4px; word-break: break-all; line-height: 1.4; }
    .lines { display: flex; flex-direction: column; gap: 12px; margin: 18px 0; }
    .line { display: flex; align-items: center; gap: 12px; }
    .line img { width: 48px; height: 48px; object-fit: cover; border-radius: var(--radius-sm); }
    .ln-name { display: flex; flex-direction: column; flex-grow: 1; }
    .ln-name span { font-size: .8rem; color: var(--ink-soft); }
    .grand { display: flex; justify-content: space-between; align-items: baseline; padding: 14px 0; border-top: 1px solid var(--line); margin-bottom: 16px; font-size: 1.1rem; }
    .grand .price { font-size: 1.5rem; }
    .coupon-row { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line-strong); border-radius: 100px; padding: 0 14px; margin-bottom: 14px; color: var(--ink-faint); }
    .coupon-row input { flex: 1; border: none; background: none; outline: none; height: 42px; font-family: var(--font-sans); font-size: .88rem; color: var(--ink); letter-spacing: .03em; }
    .pay-methods { margin: 4px 0 16px; }
    .pm-label { display: block; font-size: .82rem; font-weight: 600; color: var(--ink-soft); margin-bottom: 10px; }
    .pm-loading { display: flex; align-items: center; gap: 8px; color: var(--ink-faint); font-size: .85rem; }
    .pm-list { display: flex; flex-direction: column; gap: 8px; }
    .pm { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 14px; border: 1.5px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; font-family: var(--font-sans); transition: border-color .16s, background .16s; }
    .pm:hover { border-color: var(--brand); }
    .pm.on { border-color: var(--brand); background: var(--brand-soft, rgba(79,70,229,.08)); }
    .pm-name { flex: 1; font-weight: 600; font-size: .9rem; color: var(--ink); }
    .pm-radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-strong); flex-shrink: 0; transition: border-color .16s; }
    .pm-radio.on { border-color: var(--brand); background: radial-gradient(circle at center, var(--brand) 0 5px, transparent 6px); }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 100px; font-size: .74rem; font-weight: 600; }
    .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn, #b25e00); background: var(--warn-soft, #fff4e5); }
    .badge.paid, .badge.completed { color: var(--auto, #137333); background: var(--auto-soft, #e6f4ea); }
    .badge.expired, .badge.cancelled { color: var(--price); background: var(--price-soft); }
  `}</style>
);
