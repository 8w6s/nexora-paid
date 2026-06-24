import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { fadeRise, staggerIn } from "../lib/motion";
import { AnimatedBackground } from "./AnimatedBackground";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";

// `comingSoon` toggles are rendered as locked cards — the flag exists in the
// backend FEATURES map but no chain watcher / route is wired yet, so letting
// the admin flip it on would silently break checkout. Will graduate when the
// Cluster C multi-crypto work lands.
const TOGGLEABLE = [
  { key: "reviews", label: "Product reviews", desc: "Customer ratings & feedback", icon: "star" },
  { key: "coupons", label: "Discount coupons", desc: "Promo codes & campaigns", icon: "tag" },
  { key: "wishlist", label: "Wishlist", desc: "Save products for later", icon: "star" },
  { key: "tickets", label: "Support tickets", desc: "Customer support ticketing", icon: "ticket" },
  { key: "flash_sale", label: "Flash sales", desc: "Timed high-discount deals", icon: "zap" },
  { key: "search", label: "Search & filters", desc: "Filter catalog by keywords", icon: "search" },
  { key: "dark_mode", label: "Dark mode", desc: "Sleek dark theme support", icon: "moon" },
  { key: "email", label: "Transactional email", desc: "Automatic email receipts", icon: "mail" },
  {
    key: "coin_LTC",
    label: "Accept Litecoin",
    desc: "Self-hosted LTC wallet",
    icon: "credit-card",
  },
  {
    key: "coin_BTC",
    label: "Accept Bitcoin",
    desc: "Self-hosted BTC wallet",
    icon: "credit-card",
    comingSoon: true,
  },
  {
    key: "coin_ETH",
    label: "Accept Ethereum",
    desc: "Self-hosted ETH wallet",
    icon: "credit-card",
    comingSoon: true,
  },
] as { key: string; label: string; desc: string; icon: string; comingSoon?: boolean }[];

export const SetupWizard: React.FC = () => {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [step, setStep] = useState(1);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [storeName, setStoreName] = useState("Nexora Store");
  const [faKitUrl, _setFaKitUrl] = useState("");
  const [ltcXpub, _setLtcXpub] = useState("");
  const [features, setFeatures] = useState<Record<string, boolean>>(
    // coming-soon toggles default off and stay off; email defaults off (admin
    // has to wire SMTP first); everything else defaults on for a friendly
    // out-of-box experience.
    Object.fromEntries(TOGGLEABLE.map((f) => [f.key, !f.comingSoon && f.key !== "email"])),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stepRef = useRef<HTMLDivElement>(null);

  // Animate each step into view (fields rise + stagger) when the step changes.
  useEffect(() => {
    const el = stepRef.current;
    if (!el) return;
    fadeRise(el, { duration: 420 });
    const fields = el.querySelectorAll("label, .su-toggle-card, h2, .su-row, .btn, .su-subhead");
    if (fields.length) staggerIn(fields, { stagger: 45, duration: 400 });
  }, []);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>("/api/setup/status")
      .then((s) => setAllowed(s.needsSetup))
      .catch(() => setAllowed(false));
  }, []);

  if (allowed === null)
    return (
      <main className="su">
        <AnimatedBackground />
        <div className="su-state">
          <Icon name="spinner" size={26} className="is-spinning" />
        </div>
        <Styles />
      </main>
    );
  if (!allowed)
    return (
      <main className="su">
        <AnimatedBackground />
        <div className="su-state">
          <div className="su-success-icon">
            <Icon name="check" size={32} />
          </div>
          <h1>Setup completed successfully</h1>
          <p className="su-subhead">Your Nexora store is already configured and ready to go.</p>
          <div className="su-success-actions">
            <div
              className="btn btn-primary"
              style={{ cursor: "pointer" }}
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Go to storefront
            </div>
            <div
              className="btn btn-ghost"
              style={{ cursor: "pointer" }}
              onClick={() => {
                window.location.href = "/admin";
              }}
            >
              Admin Panel
            </div>
          </div>
        </div>
        <Styles />
      </main>
    );

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api.post("/api/setup", {
        adminEmail: adminEmail.trim(),
        adminPassword,
        storeName,
        faKitUrl: faKitUrl.trim() || undefined,
        ltcXpub: ltcXpub.trim() || undefined,
        features,
      });
      window.location.assign("/admin");
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : "Setup failed");
      setBusy(false);
    }
  };

  const toggleFeature = (key: string) => {
    // Coming-soon toggles are locked — user click does nothing. We still keep
    // them in the list for visibility so admins know what's planned.
    const meta = TOGGLEABLE.find((f) => f.key === key);
    if (meta?.comingSoon) return;
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <main className="su">
      <AnimatedBackground />
      <div className="su-card card">
        <div className="su-card-head">
          <div className="su-brand">
            <span className="su-logo-icon">
              <Icon name="key" size={18} />
            </span>
            <span>Nexora Setup</span>
          </div>
          <div className="su-step-indicator">Step {step} of 3</div>
        </div>

        <div className="su-progress-bar">
          <div className="su-progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
        </div>

        <div className="su-step" key={step} ref={stepRef}>
          {step === 1 && (
            <>
              <h2>Create administrator</h2>
              <p className="su-subhead">
                Set up the master account to manage your store settings, products, and sales.
              </p>

              <div className="su-form-group">
                <label>
                  <span>Admin Email</span>
                  <div className="su-input-wrapper">
                    <span className="su-input-icon">
                      <Icon name="mail" size={15} />
                    </span>
                    <input
                      className="input"
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </label>

                <label>
                  <span>Admin Password</span>
                  <div className="su-input-wrapper">
                    <span className="su-input-icon">
                      <Icon name="key" size={15} />
                    </span>
                    <PasswordInput
                      value={adminPassword}
                      onChange={setAdminPassword}
                      placeholder="Min 8 characters"
                      autoComplete="new-password"
                      minLength={8}
                    />
                  </div>
                </label>
              </div>

              <div className="su-row" style={{ justifyContent: "flex-end", marginTop: 24 }}>
                <button
                  className="btn btn-primary"
                  disabled={!adminEmail || adminPassword.length < 8}
                  onClick={() => setStep(2)}
                >
                  <span>Continue</span>
                  <Icon name="arrow-right" size={14} />
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Store Identity</h2>
              <p className="su-subhead">
                Give your digital storefront a memorable name. You can customize descriptions, theme
                colors, and logos inside the Admin Panel later.
              </p>

              <div className="su-form-group">
                <label>
                  <span>Store Name</span>
                  <div className="su-input-wrapper">
                    <span className="su-input-icon">
                      <Icon name="home" size={15} />
                    </span>
                    <input
                      className="input"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      placeholder="e.g. Nexora Store"
                    />
                  </div>
                </label>

                <div className="su-wizard-tip">
                  <div className="tip-icon">
                    <Icon name="shield" size={14} />
                  </div>
                  <div className="tip-content">
                    <strong>Payment Setup & Icons</strong>
                    <span>
                      To start receiving payments, you can configure your Litecoin HD Wallet (xpub)
                      anytime later in the Admin Settings. The default premium design and Font
                      Awesome icons are already pre-loaded and ready.
                    </span>
                  </div>
                </div>
              </div>

              <div className="su-row" style={{ marginTop: 24 }}>
                <button className="btn btn-ghost" onClick={() => setStep(1)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={() => setStep(3)}>
                  <span>Continue</span>
                  <Icon name="arrow-right" size={14} />
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Configure Store Modules</h2>
              <p className="su-subhead">
                Choose which features to activate. You can toggle any of these on/off at any time in
                the admin dashboard.
              </p>

              <div className="su-feats">
                {TOGGLEABLE.map((f) => {
                  const isChecked = !!features[f.key];
                  const locked = !!f.comingSoon;
                  return (
                    <div
                      key={f.key}
                      className={`su-toggle-card ${isChecked ? "active" : ""} ${locked ? "locked" : ""}`}
                      onClick={() => toggleFeature(f.key)}
                      aria-disabled={locked}
                      title={
                        locked
                          ? "Coming soon — backend support lands with the multi-crypto milestone"
                          : undefined
                      }
                    >
                      <span className="su-toggle-icon">
                        <Icon
                          name={f.icon as any}
                          size={15}
                          variant={isChecked ? "badge" : "duotone-regular"}
                        />
                      </span>
                      <div className="su-toggle-info">
                        <strong>
                          {f.label}
                          {locked && <span className="su-toggle-soon">Soon</span>}
                        </strong>
                        <span>{f.desc}</span>
                      </div>
                      <span className={`su-toggle-check ${isChecked ? "checked" : ""}`} />
                    </div>
                  );
                })}
              </div>

              {err && <div className="su-err">{err}</div>}

              <div className="su-row" style={{ marginTop: 24 }}>
                <button className="btn btn-ghost" onClick={() => setStep(2)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={submit} disabled={busy}>
                  {busy ? (
                    <>
                      <Icon name="spinner" size={16} className="is-spinning" />
                      <span>Configuring...</span>
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={15} />
                      <span>Finish setup</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <Styles />
    </main>
  );
};

const Styles: React.FC = () => (
  <style>{`
    .su { position: relative; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; font-family: var(--font-sans); }
    
    .su-state { position: relative; z-index: 1; max-width: 480px; padding: 48px; border-radius: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: #fff; text-align: center; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 50px rgba(0,0,0,0.3); }
    .su-state h1 { font-size: 1.6rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    .su-subhead { font-size: 0.9rem; color: #94a3b8; line-height: 1.5; margin-bottom: 8px; }
    .su-state .su-subhead { color: rgba(255,255,255,0.7); }
    .su-success-icon { width: 64px; height: 64px; border-radius: 50%; background: var(--auto, #10b981); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-bottom: 8px; box-shadow: 0 0 20px rgba(16, 185, 129, 0.4); }
    .su-success-actions { display: flex; gap: 12px; width: 100%; margin-top: 12px; }
    .su-success-actions .btn { flex: 1; justify-content: center; }

    /* Frosted glass premium container — Dark mode by default for high contrast over abstract neon background */
    .su-card { position: relative; z-index: 1; width: 100%; max-width: 640px; padding: 36px 40px; display: flex; flex-direction: column; gap: 24px;
      background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(30px) saturate(1.7); -webkit-backdrop-filter: blur(30px) saturate(1.7);
      border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      border-radius: 24px; color: #ffffff; }
    
    .su-card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .su-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.15rem; color: #ffffff; letter-spacing: -0.02em; }
    .su-brand .accent { color: #818cf8; }
    .su-logo-icon { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: #6366f1; color: #fff; box-shadow: 0 4px 10px rgba(99, 102, 241, 0.4); }
    .su-step-indicator { font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }

    /* Nice progress bar */
    .su-progress-bar { width: 100%; height: 5px; background: rgba(255, 255, 255, 0.1); border-radius: 10px; overflow: hidden; margin-top: -8px; }
    .su-progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #3b82f6); border-radius: 10px; transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1); }

    .su-step { display: flex; flex-direction: column; gap: 20px; }
    .su-step h2 { font-size: 1.45rem; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; margin-bottom: -12px; }
    
    /* Layout forms */
    .su-form-group { display: flex; flex-direction: column; gap: 18px; margin-top: 12px; }
    .su-card label { display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; font-weight: 700; color: #94a3b8; }
    
    .su-input-wrapper { position: relative; display: flex; align-items: center; width: 100%; }
    .su-input-icon { position: absolute; left: 14px; color: #94a3b8; pointer-events: none; display: flex; align-items: center; z-index: 10; }
    .su-input-wrapper input, .su-input-wrapper .input { width: 100%; padding-left: 42px !important; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; height: 48px; font-size: 0.92rem; color: #ffffff; transition: border-color 0.15s, box-shadow 0.15s; }
    .su-input-wrapper input:focus, .su-input-wrapper .input:focus-within { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2); }
    .su-input-wrapper .pw { width: 100%; }
    .su-input-wrapper input::placeholder { color: #475569; }
    .hint-text { font-size: 0.76rem; color: #64748b; font-weight: 400; margin-top: 2px; }

    .su-row { display: flex; gap: 12px; }
    
    .su-wizard-tip { display: flex; gap: 12px; padding: 14px 16px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.18); border-radius: 14px; margin-top: 8px; }
    .su-wizard-tip .tip-icon { color: #818cf8; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .su-wizard-tip .tip-content { display: flex; flex-direction: column; gap: 2px; }
    .su-wizard-tip .tip-content strong { font-size: 0.82rem; color: #ffffff; font-weight: 700; }
    .su-wizard-tip .tip-content span { font-size: 0.76rem; color: #94a3b8; line-height: 1.4; }
    
    /* Interactive Module Toggle Cards */
    .su-feats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
    .su-toggle-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; background: rgba(30, 41, 59, 0.4); cursor: pointer; transition: all 0.18s ease; user-select: none; }
    .su-toggle-card:hover { border-color: #6366f1; background: rgba(30, 41, 59, 0.7); transform: translateY(-1px); }
    .su-toggle-card.active { border-color: #6366f1; background: rgba(99, 102, 241, 0.12); }
    
    .su-toggle-icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .su-toggle-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .su-toggle-info strong { font-size: 0.86rem; color: #ffffff; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .su-toggle-info span { font-size: 0.74rem; color: #94a3b8; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    .su-toggle-check { width: 18px; height: 18px; border-radius: 6px; border: 2px solid rgba(255, 255, 255, 0.15); position: relative; transition: all 0.15s; flex-shrink: 0; }
    .su-toggle-card.active .su-toggle-check { border-color: #6366f1; background: #6366f1; }
    .su-toggle-card.active .su-toggle-check::after { content: ""; position: absolute; left: 5px; top: 2px; width: 4px; height: 8px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .su-toggle-card.locked { cursor: not-allowed; opacity: 0.55; }
    .su-toggle-card.locked:hover { transform: none; border-color: rgba(255, 255, 255, 0.08); background: rgba(30, 41, 59, 0.4); }
    .su-toggle-soon { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 100px; background: rgba(99, 102, 241, 0.18); color: #c7d2fe; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; vertical-align: middle; }

    .su-err { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; padding: 10px 14px; border-radius: 12px; font-size: 0.82rem; font-weight: 600; }
    
    /* Buttons */
    .btn { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; height: 44px; padding: 0 20px; border-radius: 100px; cursor: pointer; transition: all 0.15s ease; font-size: 0.88rem; }
    .btn-primary { background: linear-gradient(135deg, #6366f1, #3b82f6); color: #ffffff; border: none; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3); }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4); }
    .btn-primary:active { transform: none; }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-ghost { background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); color: #cbd5e1; }
    .btn-ghost:hover { background: rgba(255, 255, 255, 0.05); color: #ffffff; }

    @media (max-width: 600px) {
      .su { padding: 16px; }
      .su-card { padding: 24px; border-radius: 20px; }
      .su-feats { grid-template-columns: 1fr; }
    }
  `}</style>
);
