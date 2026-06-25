import type React from "react";
import { useEffect, useState } from "react";
import {
  api,
  type CheckoutResult,
  fmtUsd,
  goTo404,
  isAccessDenied,
  type OrderDetail,
  type OrderStatus,
} from "../lib/api";
import { useT } from "../i18n";
import { useAuth } from "./AuthContext";
import { useCart } from "./CartContext";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";
import { Sk, SkeletonStyles } from "./Skeleton";

function useLdrs() {
  useEffect(() => {
    import("ldrs").then(({ chaoticOrbit, cardio }) => {
      chaoticOrbit.register();
      cardio.register();
    });
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

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

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
  const { t } = useT();
  const label: Record<string, string> = {
    pending: t("storefront.checkout.awaitingPayment"),
    awaiting_payment: t("storefront.checkout.awaitingPayment"),
    underpaid: t("storefront.checkout.underpaid"),
    paid: t("storefront.checkout.paid"),
    completed: t("storefront.checkout.completed"),
    expired: t("storefront.checkout.expired"),
    cancelled: t("storefront.checkout.expired"),
  };
  const waiting = status === "pending" || status === "awaiting_payment" || status === "underpaid";
  return (
    <span className={`badge ${status}`}>
      {waiting && <l-cardio size="14" stroke="2" speed="2" color="currentColor"></l-cardio>}
      {label[status] ?? status}
    </span>
  );
};

const CopyBtn: React.FC<{ value: string; label?: string; small?: boolean }> = ({
  value,
  label,
  small,
}) => {
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
  const { t } = useT();
  // Guest = no logged-in session AND order is reached via the URL token, not a
  // real account session. We surface a stronger "save this link" warning for
  // them because they have no /orders page to return to.
  const isGuest = !user && !!token;
  useLdrs();

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    const queryStr = token ? `?token=${token}` : "";
    const startedAt = Date.now();

    api
      .get<OrderDetail>(`/api/orders/${orderId}${queryStr}`, { signal: ac.signal })
      .then((d) => alive && setDetail(d))
      .catch((e) => {
        if (!alive || (e instanceof DOMException && e.name === "AbortError")) return;
        if (isAccessDenied(e)) {
          goTo404();
          return;
        }
        setErr(e.message);
      });

    // Inflight guard: visibilitychange + the 5s interval can both fire
    // simultaneously when the tab regains focus, double-firing the GET
    // and racing setSt() callbacks. One poll at a time, max.
    let inflight = false;
    const poll = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const s = await api.get<OrderStatus>(`/api/orders/${orderId}/status${queryStr}`, {
          signal: ac.signal,
        });
        if (!alive) return;
        setSt(s);
        if (s.status === "paid" || s.status === "completed") {
          const d = await api.get<OrderDetail>(`/api/orders/${orderId}${queryStr}`, {
            signal: ac.signal,
          });
          if (alive) setDetail(d);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (alive && isAccessDenied(e)) goTo404();
      } finally {
        inflight = false;
      }
    };
    poll();

    // Adaptive backoff: 5s for the first minute (most checkouts complete
    // here), 10s up to 5 min, 20s after that. A long-abandoned tab on
    // 5s polling for the full 15 min payment window burns 180 requests
    // for nothing.
    const tick = () => {
      if (!document.hidden) poll();
    };
    let interval = setInterval(tick, 5_000);
    const reschedule = () => {
      const elapsed = Date.now() - startedAt;
      const next = elapsed > 5 * 60_000 ? 20_000 : elapsed > 60_000 ? 10_000 : 5_000;
      clearInterval(interval);
      interval = setInterval(tick, next);
    };
    const escalation = setInterval(reschedule, 30_000);

    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      ac.abort();
      clearInterval(interval);
      clearInterval(escalation);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [orderId, token]);

  if (err) return <div className="co-state">{err}</div>;
  if (!detail)
    return (
      <div className="pay card">
        <div className="pay-head">
          <div>
            <Sk w={50} h={11} />
            <Sk w={130} h={22} style={{ marginTop: 6 }} />
          </div>
          <Sk w={80} h={22} r={100} />
        </div>
        <Sk h={14} style={{ margin: "16px 0" }} />
        <Sk h={14} w="70%" style={{ marginBottom: 16 }} />
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <Sk w={220} h={220} r={8} />
        </div>
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
        <div>
          <span className="muted">#</span>
          <h1>{detail.id}</h1>
        </div>
        <StatusBadge status={status} />
      </div>

      {done ? (
        <div className="delivered">
          <div className="ok-banner">
            <span className="ok-ico">
              <Icon name="check" size={20} />
            </span>
            <div>
              <strong>{t("storefront.checkout.paid")}</strong>
              <span>{t("storefront.checkout.yourKeys")}</span>
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
                  <strong>{t("storefront.checkout.bookmarkPage")}</strong>
                  <span>{t("storefront.checkout.emailNotConfigured")}</span>
                </div>
              </div>
              <p className="hint">
                <Icon name="key" size={14} />{" "}
                <a href="/register" className="hint-link">
                  {t("storefront.auth.createAccount")}
                </a>
              </p>
            </>
          ) : (
            <p className="hint">
              <Icon name="shield" size={14} />{" "}
              <a href="/orders" className="hint-link">
                {t("storefront.account.myOrders")}
              </a>
            </p>
          )}
        </div>
      ) : expired ? (
        <div className="co-state">
          {t("storefront.checkout.expired")}.{" "}
          <a href="/" className="hint-link">
            {t("storefront.checkout.expiredCta")}
          </a>
        </div>
      ) : (
        <>
          <p className="instructions">
            {t("storefront.checkout.sendExactly", { amount: detail.ltcAmount, currency: "LTC" })}
          </p>
          <div className="qr-wrap">
            <div className="qr">
              <img src={detail.qrCodeUrl} alt="Litecoin payment QR" width={220} height={220} />
            </div>
            <span className="qr-chip">
              <Icon name="bolt" size={12} /> {t("storefront.checkout.scanQr")}
            </span>
          </div>
          <div className="field">
            <label>{t("storefront.checkout.copyAddress")}</label>
            <div className="field-row">
              <code className="addr">{detail.ltcAddress}</code>
              <CopyBtn value={detail.ltcAddress} label={t("common.copy")} />
            </div>
          </div>
          <div className="field">
            <label>{t("storefront.checkout.copyAmount")}</label>
            <div className="field-row">
              <code className="addr">{detail.ltcAmount} LTC</code>
              <CopyBtn value={detail.ltcAmount} label={t("common.copy")} />
            </div>
          </div>
          {(() => {
            const step = activeStep(st, status);
            const stepIdx = STEPS.findIndex((s) => s.key === step);
            const required = st?.requiredConfirmations ?? 2;
            const current = Math.min(Math.max(0, st?.confirmations ?? 0), required);
            const remaining = Math.max(0, required - current);
            const etaText =
              remaining === 0 ? "any moment" : `~${Math.ceil(remaining * LTC_BLOCK_MIN)} min`;
            return (
              <div
                className="conf-stepper"
                role="progressbar"
                aria-valuenow={stepIdx + 1}
                aria-valuemin={1}
                aria-valuemax={STEPS.length}
              >
                {STEPS.map((s, idx) => {
                  const isActive = idx === stepIdx;
                  const isDone = idx < stepIdx;
                  return (
                    <div
                      key={s.key}
                      className={`cs-step${isActive ? " on" : ""}${isDone ? " done" : ""}`}
                    >
                      <span className="cs-dot">
                        {isDone ? (
                          <Icon name="check" size={12} />
                        ) : (
                          <span className="cs-num">{idx + 1}</span>
                        )}
                      </span>
                      <span className="cs-label">
                        {s.label}
                        {isActive && s.key === "confirming" && (
                          <em className="cs-meta">
                            {current}/{required} · {etaText}
                          </em>
                        )}
                        {isActive && s.key === "seen" && <em className="cs-meta">on chain</em>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="pay-meta">
            <div>
              <span>{t("storefront.cart.total")}</span>
              <strong>{fmtUsd(detail.totalUsd)}</strong>
            </div>
            <div>
              <span>{t("storefront.checkout.expiresIn")}</span>
              <strong className="mono">{st ? mmss(st.expiresInSec) : "—"}</strong>
            </div>
          </div>
          {status === "underpaid" && st && (
            <div className="warn">
              {t("storefront.checkout.underpaidHint", {
                received: String(st.receivedLitoshi ?? 0),
                expected: detail.ltcAmount,
                currency: "LTC",
                missing: detail.ltcAmount,
              })}
            </div>
          )}
          <p className="hint">
            <l-chaotic-orbit size="16" speed="1.5" color="currentColor"></l-chaotic-orbit>{" "}
            {t("storefront.checkout.checking")}
          </p>
        </>
      )}
      <CheckoutStyles />
    </div>
  );
};

interface PayMethod {
  id: string;
  label: string;
  kind: string;
}
const BrandIcon: React.FC<{ id: string; size?: number }> = ({ id, size = 26 }) => {
  if (id === "crypto_btc") {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <path
          d="M 76.8 0 L 435.2 0 C 477.587 0 512 34.413 512 76.8 L 512 435.2 C 512 477.587 477.587 512 435.2 512 L 76.8 512 C 34.413 512 0 477.587 0 435.2 L 0 76.8 C 0 34.413 34.413 0 76.8 0 Z"
          fill="#F7931A"
        />
        <path
          d="M 388.343 221.491 C 393.88 184.483 365.702 164.589 327.173 151.317 L 339.672 101.185 L 309.156 93.58 L 296.988 142.391 C 288.966 140.392 280.727 138.506 272.54 136.637 L 284.794 87.505 L 254.296 79.9 L 241.79 130.014 C 235.149 128.502 228.631 127.007 222.304 125.434 L 222.338 125.278 L 180.255 114.77 L 172.137 147.362 C 172.137 147.362 194.778 152.551 194.3 152.873 C 206.659 155.958 208.893 164.137 208.519 170.62 L 194.283 227.731 C 195.134 227.949 196.238 228.262 197.455 228.748 C 196.438 228.496 195.352 228.218 194.23 227.949 L 174.275 307.953 C 172.763 311.707 168.93 317.339 160.291 315.201 C 160.595 315.644 138.11 309.665 138.11 309.665 L 122.961 344.595 L 162.672 354.495 C 170.06 356.346 177.3 358.284 184.427 360.109 L 171.798 410.815 L 202.279 418.42 L 214.786 368.253 C 223.112 370.513 231.195 372.599 239.104 374.563 L 226.641 424.495 L 257.156 432.1 L 269.784 381.49 C 321.82 391.338 360.948 387.366 377.418 340.302 C 390.69 302.408 376.758 280.549 349.38 266.295 C 369.318 261.697 384.337 248.582 388.343 221.491 Z M 318.621 319.26 C 309.191 357.154 245.388 336.669 224.702 331.532 L 241.459 264.357 C 262.145 269.519 328.477 279.74 318.621 319.26 Z M 328.06 220.943 C 319.456 255.413 266.351 237.9 249.125 233.607 L 264.318 172.68 C 281.544 176.974 337.021 184.987 328.06 220.943 Z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }
  if (id === "crypto_ltc") {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <path
          d="M 76.8 0 L 435.2 0 C 477.587 0 512 34.413 512 76.8 L 512 435.2 C 512 477.587 477.587 512 435.2 512 L 76.8 512 C 34.413 512 0 477.587 0 435.2 L 0 76.8 C 0 34.413 34.413 0 76.8 0 Z"
          fill="#345D9D"
        />
        <circle cx="256" cy="256" r="175" fill="#FFFFFF" />
        <path
          d="M 256 41 C 137.259 41 41 137.259 41 256 C 41 374.741 137.259 471 256 471 C 374.741 471 470.999 374.741 470.999 256 L 470.999 256 C 471.165 199.144 448.738 144.551 408.652 104.231 C 368.566 63.911 314.105 41.166 257.249 41 L 256 41 Z M 259.644 263.288 L 237.259 338.772 L 356.992 338.772 C 358.594 338.716 360.152 339.299 361.324 340.393 C 362.496 341.486 363.185 343.001 363.239 344.603 L 363.239 346.581 L 352.827 382.501 C 351.882 386 348.64 388.377 345.019 388.227 L 161.775 388.227 L 192.489 283.591 L 158.131 294.002 L 165.939 270.056 L 200.297 259.644 L 243.506 112.84 C 244.484 109.365 247.705 107.003 251.314 107.114 L 297.646 107.114 C 299.248 107.058 300.806 107.641 301.978 108.734 C 303.15 109.828 303.839 111.343 303.893 112.945 L 303.893 114.923 L 267.452 238.821 L 301.811 228.409 L 294.522 253.397 L 259.644 263.288 Z"
          fill="#345D9D"
        />
      </svg>
    );
  }
  if (id === "crypto_eth") {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <path
          d="M 76.8 0 L 435.2 0 C 477.587 0 512 34.413 512 76.8 L 512 435.2 C 512 477.587 477.587 512 435.2 512 L 76.8 512 C 34.413 512 0 477.587 0 435.2 L 0 76.8 C 0 34.413 34.413 0 76.8 0 Z"
          fill="#627EEA"
        />
        <path
          d="M 255.981 81 L 253.633 88.976 L 253.633 320.394 L 255.981 322.737 L 363.402 259.24 L 255.981 81 Z"
          fill="#C1CCF8"
        />
        <path
          d="M 255.955 81 L 148.533 259.24 L 255.955 322.737 L 255.955 210.413 L 255.955 81 Z"
          fill="#FFFFFF"
        />
        <path
          d="M 255.983 343.088 L 254.659 344.702 L 254.659 427.137 L 255.983 431 L 363.467 279.625 L 255.983 343.088 Z"
          fill="#C1CCF8"
        />
        <path
          d="M 255.955 431 L 255.955 343.088 L 148.533 279.625 L 255.955 431 Z"
          fill="#FFFFFF"
        />
        <path
          d="M 256.026 322.735 L 363.445 259.239 L 256.026 210.411 L 256.026 322.735 Z"
          fill="#8197EE"
        />
      </svg>
    );
  }
  if (id === "crypto_sol") {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <defs>
          <clipPath id="_clipPath_mYAZQYB0OspfKnvspMbmwj6tQ4mQt5hb">
            <rect width="512" height="512" />
          </clipPath>
        </defs>
        <g clipPath="url(#_clipPath_mYAZQYB0OspfKnvspMbmwj6tQ4mQt5hb)">
          <clipPath id="_clipPath_e6AhEm7wqeFcqgyblWmuKS4A7JRMw698">
            <rect x="0" y="0" width="512" height="512" fill="#FFFFFF" />
          </clipPath>
          <g clipPath="url(#_clipPath_e6AhEm7wqeFcqgyblWmuKS4A7JRMw698)">
            <g>
              <path
                d=" M 76.8 0 L 435.2 0 C 477.587 0 512 34.413 512 76.8 L 512 435.2 C 512 477.587 477.587 512 435.2 512 L 76.8 512 C 34.413 512 0 477.587 0 435.2 L 0 76.8 C 0 34.413 34.413 0 76.8 0 Z "
                fill="#1E1E1E"
              />
              <g>
                <linearGradient
                  id="_lgradient_0"
                  x1="0.00003"
                  y1="14.894"
                  x2="1.0256"
                  y2="14.8847"
                  gradientTransform="matrix(350,0,0,65.748,81,123.123)"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopOpacity="1" stopColor="rgb(89,157,176)" />
                  <stop offset="100%" stopOpacity="1" stopColor="rgb(71,248,195)" />
                </linearGradient>
                <path
                  d=" M 380.717 185.701 C 378.533 187.704 375.688 188.832 372.725 188.871 L 92.27 188.871 C 82.314 188.871 77.297 177.494 84.181 170.824 L 130.249 126.409 C 132.389 124.336 135.242 123.16 138.222 123.123 L 419.746 123.123 C 429.799 123.123 434.719 134.596 427.719 141.305 L 380.717 185.701 Z "
                  fill="url(#_lgradient_0)"
                />
                <linearGradient
                  id="_lgradient_1"
                  x1="0.00003"
                  y1="-2.0059"
                  x2="1.019"
                  y2="-2.0138"
                  gradientTransform="matrix(350,0,0,65.651,81,342.01)"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopOpacity="1" stopColor="rgb(196,79,226)" />
                  <stop offset="100%" stopOpacity="1" stopColor="rgb(115,176,208)" />
                </linearGradient>
                <path
                  d=" M 380.717 404.588 C 378.519 406.556 375.675 407.649 372.725 407.661 L 92.27 407.661 C 82.314 407.661 77.297 396.382 84.181 389.712 L 130.249 345.18 C 132.408 343.149 135.258 342.016 138.222 342.01 L 419.746 342.01 C 429.799 342.01 434.719 353.405 427.719 360.056 L 380.717 404.588 Z "
                  fill="url(#_lgradient_1)"
                />
                <linearGradient
                  id="_lgradient_2"
                  x1="0.0575"
                  y1="0.5"
                  x2="0.9613"
                  y2="0.5"
                  gradientTransform="matrix(350,0,0,65.651,81,232.625)"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopOpacity="1" stopColor="rgb(119,140,191)" />
                  <stop offset="100%" stopOpacity="1" stopColor="rgb(93,205,201)" />
                </linearGradient>
                <path
                  d=" M 380.717 235.697 C 378.519 233.73 375.675 232.636 372.725 232.625 L 92.27 232.625 C 82.314 232.625 77.297 243.903 84.181 250.574 L 130.249 295.106 C 132.408 297.108 135.247 298.217 138.222 298.275 L 419.746 298.275 C 429.799 298.275 434.719 286.88 427.719 280.229 L 380.717 235.697 Z "
                  fill="url(#_lgradient_2)"
                />
              </g>
            </g>
          </g>
        </g>
      </svg>
    );
  }
  if (id === "stripe") {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <path
          d="M 76.8 0 L 435.2 0 C 477.587 0 512 34.413 512 76.8 L 512 435.2 C 512 477.587 477.587 512 435.2 512 L 76.8 512 C 34.413 512 0 477.587 0 435.2 L 0 76.8 C 0 34.413 34.413 0 76.8 0 Z"
          fill="#635BFF"
        />
        <path
          d="M 231.036 184.786 C 231.036 169.692 243.421 163.886 263.934 163.886 C 293.349 163.886 330.504 172.788 359.918 188.656 L 359.918 97.704 C 327.795 84.931 296.058 79.9 263.934 79.9 C 185.366 79.9 133.117 120.925 133.117 189.43 C 133.117 296.251 280.19 279.222 280.19 325.279 C 280.19 343.082 264.708 348.888 243.034 348.888 C 210.911 348.888 169.885 335.729 137.374 317.925 L 137.374 410.039 C 173.368 425.52 209.75 432.1 243.034 432.1 C 323.537 432.1 378.883 392.236 378.883 322.957 C 378.496 207.621 231.036 228.134 231.036 184.786 Z"
          fillRule="evenodd"
          fill="#FFFFFF"
        />
      </svg>
    );
  }
  if (id === "paypal") {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <path
          d="M 76.8 0 L 435.2 0 C 477.587 0 512 34.413 512 76.8 L 512 435.2 C 512 477.587 477.587 512 435.2 512 L 76.8 512 C 34.413 512 0 477.587 0 435.2 L 0 76.8 C 0 34.413 34.413 0 76.8 0 Z"
          fill="#FFFFFF"
        />
        <path
          d="M 224.538 149.206 C 219.49 149.205 215.192 152.877 214.404 157.864 L 197.561 264.664 L 182.085 362.8 L 182.076 362.882 L 182.095 362.8 L 197.57 264.664 C 198.357 259.676 202.651 256.006 207.699 256.006 L 257.042 256.006 C 306.7 256.006 348.849 219.776 356.546 170.681 C 357.133 166.951 357.447 163.257 357.518 159.611 L 357.518 159.605 L 357.512 159.605 C 344.892 152.984 330.073 149.206 313.835 149.206 L 224.538 149.206 Z"
          fill="#001C64"
        />
        <path
          d="M 357.514 159.607 C 357.445 163.253 357.127 166.951 356.542 170.681 C 348.845 219.776 306.697 256.006 257.038 256.006 L 207.695 256.006 C 202.647 256.006 198.353 259.676 197.566 264.664 L 182.091 362.8 L 172.379 424.37 C 172.001 426.777 172.694 429.229 174.277 431.081 C 175.86 432.933 178.175 434 180.611 434 L 234.17 434 C 239.218 434 243.516 430.328 244.304 425.342 L 258.413 335.864 C 259.204 330.876 263.5 327.2 268.548 327.2 L 300.085 327.2 C 349.744 327.2 391.886 290.972 399.584 241.881 C 405.048 207.031 387.511 175.327 357.516 159.607 L 357.514 159.607 Z"
          fill="#0070E0"
        />
        <path
          d="M 163.687 78 C 158.638 78 154.339 81.675 153.553 86.664 L 111.526 353.165 C 111.146 355.572 111.839 358.026 113.422 359.879 C 115.005 361.733 117.321 362.8 119.758 362.8 L 182.084 362.8 L 197.559 264.664 L 214.402 157.864 C 215.19 152.877 219.488 149.205 224.536 149.206 L 313.83 149.206 C 330.071 149.206 344.891 152.99 357.512 159.602 C 358.372 114.906 321.492 78 270.779 78 L 163.687 78 Z"
          fill="#003087"
        />
      </svg>
    );
  }
  return (
    <div className="pay-method-icon-generic" style={{ color: "var(--ink-soft)" }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 21h18M3 10h18M5 10v11M19 10v11M9 10v11M15 10v11M12 2L3 7h18z" />
      </svg>
    </div>
  );
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
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [methods, setMethods] = useState<PayMethod[] | null>(null);
  const [method, setMethod] = useState<string>("");
  const [coupon, setCoupon] = useState("");
  const [email, setEmail] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string>("VN");
  useLdrs();

  useEffect(() => {
    // Re-fetch only when the country changes — including `method` in deps
    // would refetch every time the user clicks a different radio (we already
    // setMethod inside the .then, which would re-trigger this effect).
    setMethods(null);
    const ac = new AbortController();
    api
      .get<{ methods: PayMethod[] }>(`/api/payments?country=${selectedCountry}`, {
        signal: ac.signal,
      })
      .then((d) => {
        setMethods(d.methods);
        setMethod((cur) => {
          if (d.methods.length === 0) return "";
          return d.methods.some((m) => m.id === cur) ? cur : d.methods[0].id;
        });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setMethods([]);
        setMethod("");
      });
    return () => ac.abort();
  }, [selectedCountry]);

  const pay = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!user && !email.trim()) {
        setErr(t("storefront.checkout.email"));
        setBusy(false);
        return;
      }
      const res = await api.post<CheckoutResult & { orderToken?: string }>("/api/checkout", {
        items: cart.map((c) => ({
          productId: c.product.id,
          variantId: c.variant?.id ?? undefined,
          qty: c.quantity,
        })),
        method,
        coupon: coupon.trim() || undefined,
        email: !user ? email.trim() : undefined,
      });
      clearCart();
      const tokenQuery = res.orderToken ? `&token=${res.orderToken}` : "";
      window.location.assign(`/checkout?id=${res.orderId}${tokenQuery}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("storefront.errors.generic"));
      setBusy(false);
    }
  };

  if (cart.length === 0)
    return (
      <div className="co-state">
        {t("storefront.cart.empty")}.{" "}
        <a href="/" className="hint-link">
          {t("storefront.cart.continueShopping")}
        </a>
      </div>
    );

  return (
    <div className="review card">
      <h1>{t("storefront.checkout.title")}</h1>
      <div className="lines">
        {cart.map((c) => (
          <div key={`${c.product.id}_${c.variant?.id ?? ""}`} className="line">
            <img src={c.product.image} alt={c.product.name} width={48} height={48} loading="lazy" />
            <div className="ln-name">
              <strong>
                {c.product.name}
                {c.variant ? ` (${c.variant.name})` : ""}
              </strong>
              <span>
                {fmtUsd(c.variant ? c.variant.priceUsd : c.product.priceUsd)} × {c.quantity}
              </span>
            </div>
            <span className="ln-total price">
              {fmtUsd((c.variant ? c.variant.priceUsd : c.product.priceUsd) * c.quantity)}
            </span>
          </div>
        ))}
      </div>

      <div className="field" style={{ margin: "20px 0" }}>
        <label>{t("storefront.checkout.country")}</label>
        <Dropdown<string>
          value={selectedCountry}
          onChange={(v) => setSelectedCountry(v)}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
          width="100%"
        />
      </div>

      {!user && (
        <div className="field" style={{ margin: "20px 0" }}>
          <label>{t("storefront.checkout.email")}</label>
          <div className="field-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              style={{
                flex: 1,
                border: "none",
                background: "none",
                outline: "none",
                padding: "11px 13px",
                fontSize: "0.9rem",
                color: "var(--ink)",
              }}
              required
            />
          </div>
        </div>
      )}

      <div className="coupon-row">
        <Icon name="zap" size={15} />
        <input
          value={coupon}
          onChange={(e) => setCoupon(e.target.value.toUpperCase())}
          placeholder={t("storefront.checkout.couponCode")}
          aria-label={t("storefront.checkout.couponCode")}
        />
      </div>
      <div className="grand">
        <span>{t("storefront.cart.total")}</span>
        <span className="price">{fmtUsd(getCartTotal())}</span>
      </div>

      <div className="pay-methods">
        <span className="pm-label">{t("storefront.checkout.paymentMethod")}</span>
        {methods === null ? (
          <div className="pm-loading">
            <Icon name="spinner" size={18} /> {t("common.loading")}
          </div>
        ) : methods.length === 0 ? (
          <div className="warn">
            {t("storefront.errors.noWallet")}
          </div>
        ) : (
          <div className="pm-list">
            {methods.map((m) => (
              <button
                key={m.id}
                className={`pm ${method === m.id ? "on" : ""}`}
                onClick={() => setMethod(m.id)}
                type="button"
              >
                <span className="pm-icon-wrap">
                  <BrandIcon id={m.id} size={30} />
                </span>
                <span className="pm-name">{m.label}</span>
                <span className={`pm-radio ${method === m.id ? "on" : ""}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="warn">{err}</div>}
      <button
        className="btn"
        onClick={pay}
        disabled={busy || !method}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {busy ? (
          <>
            <l-chaotic-orbit size="20" speed="1.5" color="currentColor"></l-chaotic-orbit>
            <span>{t("storefront.checkout.creating")}</span>
          </>
        ) : (
          <>
            <Icon name="key" size={16} />
            <span>{t("storefront.cart.checkout")}</span>
          </>
        )}
      </button>
      {!user && <p className="hint">{t("storefront.checkout.guestNotice")}</p>}
      <CheckoutStyles />
    </div>
  );
};

export const Checkout: React.FC = () => {
  const { id, token } = useOrderQuery();
  return (
    <main className="container co-page">
      {id ? <PayView orderId={id} token={token} /> : <ReviewView />}
    </main>
  );
};

const CheckoutStyles: React.FC = () => (
  <style>{`
    .co-page { padding: 40px 20px; display: flex; justify-content: center; }
    .pay, .review { width: 100%; max-width: 540px; padding: 28px; }
    .co-state { padding: 60px 20px; text-align: center; color: var(--ink-soft); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .co-state a, .hint a, .delivered a { color: var(--brand); font-weight: 600; }
    .hint-link { color: var(--brand); font-weight: 600; cursor: pointer; }
    .hint-link:hover { text-decoration: underline; }
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
    .copy-btn.sm { width: 38px; height: 38px; padding: 0; border-left: none; border-radius: 10px; flex-shrink: 0; }

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
    .keys li { display: flex; align-items: center; gap: 10px; background: var(--surface-2); border: 1px solid var(--line); padding: 8px 8px 8px 14px; }
    .keys .k-idx { font-size: .68rem; font-weight: 700; color: var(--ink-faint); font-variant-numeric: tabular-nums; flex-shrink: 0; }
    .keys code { flex: 1; color: var(--ink); font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .88rem; letter-spacing: .4px; word-break: break-all; line-height: 1.4; }
    .copy-btn.sm { background: var(--surface); color: var(--ink-soft); border: 1px solid var(--line); }
    .copy-btn.sm:hover { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); }
    .copy-btn.sm.is-flash { background: var(--auto-soft); color: var(--auto); border-color: var(--auto); }
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
    .pm-icon-wrap { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; }
    .pm-name { flex: 1; font-weight: 600; font-size: .9rem; color: var(--ink); }
    .pm-radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-strong); flex-shrink: 0; transition: border-color .16s; }
    .pm-radio.on { border-color: var(--brand); background: radial-gradient(circle at center, var(--brand) 0 5px, transparent 6px); }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 100px; font-size: .74rem; font-weight: 600; }
    .badge.pending, .badge.awaiting_payment, .badge.underpaid { color: var(--warn, #b25e00); background: var(--warn-soft, #fff4e5); }
    .badge.paid, .badge.completed { color: var(--auto, #137333); background: var(--auto-soft, #e6f4ea); }
    .badge.expired, .badge.cancelled { color: var(--price); background: var(--price-soft); }
  `}</style>
);
