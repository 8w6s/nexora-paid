import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Dropdown } from "../Dropdown";
import { Icon } from "../Icon";
import { PasswordPromptModal } from "../PasswordPromptModal";
import { Sk, SkeletonStyles } from "../Skeleton";
import { useToast } from "../Toast";
import { ToggleSwitch } from "../ToggleSwitch";

interface Field {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
  placeholder?: string;
}
interface Provider {
  id: string;
  label: string;
  kind: string;
  countries: string[] | "*";
  note?: string;
  fields: Field[];
  enabled: boolean;
  config: Record<string, string | boolean>;
}

const COUNTRIES = [
  { code: "*", name: "Worldwide (no restriction)" },
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
  { code: "VN", name: "Vietnam" },
];

const KIND_LABEL: Record<string, string> = {
  "crypto-native": "Self-Hosted Wallet",
  "crypto-gateway": "Payment Gateway",
  card: "Credit / Debit Cards",
  wallet: "Electronic Wallet",
  manual: "Manual Processing",
};

const BrandIcon: React.FC<{ id: string; size?: number }> = ({ id, size = 28 }) => {
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

export const AdminPayments: React.FC = () => {
  const [list, setList] = useState<Provider[] | null>(null);
  const [country, setCountry] = useState("*");
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [pwPrompt, setPwPrompt] = useState<{
    provider: Provider;
    config: Record<string, string>;
  } | null>(null);
  const toast = useToast();

  const load = () =>
    api
      .get<{ shopCountry: string; providers: Provider[] }>("/api/admin/payments")
      .then((d) => {
        setList(d.providers);
        setCountry(d.shopCountry);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, [load]);

  const saveCountry = async (c: string) => {
    setCountry(c);
    try {
      await api.put("/api/admin/payments/country", { country: c });
      toast.success("Country saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const toggle = async (p: Provider) => {
    const nextEnabled = !p.enabled;
    await api.put(`/api/admin/payments/${p.id}/enabled`, { enabled: nextEnabled });
    setList(
      (prev) => prev?.map((x) => (x.id === p.id ? { ...x, enabled: nextEnabled } : x)) ?? null,
    );
    if (nextEnabled) {
      setExpandedProvider(p.id);
    }
  };

  const submitConfig = async (
    p: Provider,
    config: Record<string, string>,
    currentPassword?: string,
  ) => {
    try {
      await api.put(`/api/admin/payments/${p.id}/config`, {
        config,
        ...(currentPassword !== undefined ? { currentPassword } : {}),
      });
      setDraft((d) => ({ ...d, [p.id]: {} }));
      toast.success(`${p.label} settings saved.`);
      setExpandedProvider(null);
      setPwPrompt(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const saveConfig = async (p: Provider) => {
    const config = { ...(draft[p.id] ?? {}) };
    // Re-auth gate: crypto-native providers (LTC/BTC/ETH self-hosted) require
    // the admin's current password before rotating the receiving xpub.
    // Without this any stolen admin cookie could redirect every customer's
    // crypto deposit to an attacker wallet.
    const isCryptoNative = p.kind === "crypto-native";
    const touchingWallet =
      isCryptoNative && "xpub" in config && String(config.xpub ?? "").trim() !== "";
    if (touchingWallet) {
      setPwPrompt({ provider: p, config });
      return;
    }
    await submitConfig(p, config);
  };

  const setField = (pid: string, key: string, val: string) =>
    setDraft((d) => ({ ...d, [pid]: { ...(d[pid] ?? {}), [key]: val } }));

  // Helper to categorize providers
  const getGroupedProviders = () => {
    if (!list) return { cryptos: [], cards: [], wallets: [], others: [] };
    const cryptos: Provider[] = [];
    const cards: Provider[] = [];
    const wallets: Provider[] = [];
    const others: Provider[] = [];

    for (const p of list) {
      if (p.kind.startsWith("crypto")) cryptos.push(p);
      else if (p.kind === "card") cards.push(p);
      else if (p.kind === "wallet") wallets.push(p);
      else others.push(p);
    }
    return { cryptos, cards, wallets, others };
  };

  const { cryptos, cards, wallets, others } = getGroupedProviders();

  const renderGroup = (title: string, providers: Provider[]) => {
    if (providers.length === 0) return null;
    return (
      <div className="pay-group-section">
        <h3 className="pay-group-title">{title}</h3>
        <div className="pay-grid-layout">
          {providers.map((p) => {
            const served =
              p.countries === "*" || country === "*" || (p.countries as string[]).includes(country);
            const isExpanded = expandedProvider === p.id;
            return (
              <div
                key={p.id}
                className={`pay-method-card ${p.enabled ? "on" : ""} ${isExpanded ? "expanded" : ""}`}
              >
                <div className="pay-method-main">
                  <div className="pay-method-left">
                    <span className="pay-method-icon-wrap">
                      <BrandIcon id={p.id} size={38} />
                    </span>
                    <div className="pay-method-info">
                      <div className="pay-method-title-row">
                        <strong>{p.label}</strong>
                        <span className="pay-method-badge">{KIND_LABEL[p.kind] ?? p.kind}</span>
                      </div>
                      <span className="pay-method-sub">
                        {p.note || "Configure credentials to accept payments."}
                      </span>
                      {!served && (
                        <span className="pay-method-warning">
                          Not available in selected country ({country})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="pay-method-actions">
                    {p.enabled && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                        type="button"
                      >
                        {isExpanded ? "Close" : "Configure"}
                      </button>
                    )}
                    <ToggleSwitch
                      checked={p.enabled}
                      onChange={() => toggle(p)}
                      label={`Toggle ${p.label}`}
                    />
                  </div>
                </div>

                {isExpanded && p.enabled && (
                  <div className="pay-method-config-pane">
                    <div className="pay-method-fields">
                      {p.fields.map((f) => (
                        <label key={f.key} className="pay-field-label">
                          <span>
                            {f.label}
                            {f.optional ? " (optional)" : ""}
                            {f.secret && p.config[f.key] === true ? " — saved" : ""}
                          </span>
                          <input
                            className="input"
                            type={f.secret ? "password" : "text"}
                            placeholder={
                              f.secret && p.config[f.key] === true
                                ? "•••••• (leave blank to keep)"
                                : (f.placeholder ?? "")
                            }
                            value={
                              draft[p.id]?.[f.key] ??
                              (f.secret ? "" : (p.config[f.key] as string) || "")
                            }
                            onChange={(e) => setField(p.id, f.key, e.target.value)}
                          />
                          {f.hint && <small className="pay-hint-text">{f.hint}</small>}
                        </label>
                      ))}
                    </div>
                    <div className="pay-config-actions">
                      <button className="btn btn-ghost" onClick={() => setExpandedProvider(null)}>
                        Cancel
                      </button>
                      <button className="btn" onClick={() => saveConfig(p)}>
                        Save Settings
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="pay-admin">
      <SkeletonStyles />

      <div className="card pa-country">
        <div className="pa-country-info">
          <Icon name="home" size={16} />
          <div>
            <strong>Shop location</strong>
            <p className="muted">
              Select your shop country. Nexora filters payment methods for buyers automatically.
            </p>
          </div>
        </div>
        <Dropdown<string>
          value={country}
          onChange={(v) => saveCountry(v)}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
          width={280}
        />
      </div>

      {!list ? (
        <div className="pa-skeleton-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="pa-skeleton-item">
              <Sk h={70} r={12} />
            </div>
          ))}
        </div>
      ) : (
        <div className="pay-groups-container">
          {renderGroup("CRYPTOCURRENCY", cryptos)}
          {renderGroup("CARD PROCESSORS", cards)}
          {renderGroup("WALLETS & TRANSFERS", wallets)}
          {renderGroup("OTHER METHODS", others)}
        </div>
      )}

      <PasswordPromptModal
        open={!!pwPrompt}
        title="Confirm wallet rotation"
        message="Confirm your admin password to rotate the receiving wallet. Every future payment will route to the new xpub."
        confirmLabel="Rotate wallet"
        onCancel={() => {
          setPwPrompt(null);
          toast.error("Wallet rotation cancelled.");
        }}
        onSubmit={(pw) => {
          if (pwPrompt) submitConfig(pwPrompt.provider, pwPrompt.config, pw);
        }}
      />

      <style>{`
        .pay-admin { display: flex; flex-direction: column; gap: 24px; }
        .pa-country { padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border: 1.5px solid var(--line-strong); }
        .pa-country-info { display: flex; align-items: center; gap: 14px; }
        .pa-country-info svg { color: var(--brand); }
        .pa-country-info strong { font-size: 1rem; color: var(--ink); }
        .muted { color: var(--ink-soft); font-size: .86rem; margin-top: 2px; }
        
        .pa-skeleton-grid { display: flex; flex-direction: column; gap: 16px; }
        .pa-skeleton-item { width: 100%; }

        .pay-groups-container { display: flex; flex-direction: column; gap: 32px; }
        .pay-group-section { display: flex; flex-direction: column; gap: 14px; }
        .pay-group-title { font-size: 0.76rem; font-weight: 700; color: var(--ink-faint); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 2px; }
        
        .pay-grid-layout { display: grid; grid-template-columns: 1fr; gap: 14px; }
        
        .pay-method-card { border: 1.5px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); transition: all 0.2s var(--ease); overflow: hidden; }
        .pay-method-card.on { border-color: var(--line-strong); }
        .pay-method-card:hover { border-color: var(--brand); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.02); }
        .pay-method-card.expanded { border-color: var(--brand); }

        .pay-method-main { padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .pay-method-left { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
        
        .pay-method-icon-wrap { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; }
        .pay-method-icon-generic { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; background: var(--surface-2); color: var(--ink-soft); }
        
        .pay-method-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .pay-method-title-row { display: flex; align-items: center; gap: 10px; }
        .pay-method-title-row strong { font-size: 1rem; color: var(--ink); font-weight: 700; }
        
        .pay-method-badge { font-size: .68rem; font-weight: 600; padding: 2px 8px; border-radius: 100px; background: var(--surface-2); color: var(--ink-soft); text-transform: capitalize; }
        .pay-method-sub { font-size: .84rem; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pay-method-warning { font-size: .78rem; color: var(--warn, #b25e00); font-weight: 600; margin-top: 2px; }
        
        .pay-method-actions { display: flex; align-items: center; gap: 12px; }
        
        .pay-method-config-pane { padding: 24px 28px; background: var(--surface-2); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 20px; }
        .pay-method-fields { display: grid; grid-template-columns: 1fr; gap: 16px; }
        
        .pay-field-label { display: flex; flex-direction: column; gap: 6px; font-size: .84rem; font-weight: 600; color: var(--ink); }
        .pay-field-label input { width: 100%; padding: 10px 14px; font-size: 0.92rem; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--surface); }
        
        .pay-hint-text { font-size: .78rem; font-weight: 400; color: var(--ink-faint); line-height: 1.4; margin-top: 2px; }
        
        .pay-config-actions { display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--line-strong); padding-top: 16px; }

        @media (max-width: 768px) {
          .pay-method-main { flex-direction: column; align-items: stretch; }
          .pay-method-actions { justify-content: space-between; width: 100%; border-top: 1px solid var(--line-strong); padding-top: 14px; }
        }
      `}</style>
    </div>
  );
};
