import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { fadeRise } from "../../lib/motion";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";

// Multi-step "create product" flow (template -> name -> price -> stock -> publish).
// SellAuth-style templates.
const TEMPLATES = [
  {
    key: "Software",
    icon: "key",
    title: "Serial Keys / License Keys",
    desc: "Software licenses, game keys, activation codes",
  },
  {
    key: "Entertainment",
    icon: "users",
    title: "Accounts",
    desc: "Pre-made accounts, streaming accounts, gaming accounts",
  },
  {
    key: "Game",
    icon: "bolt",
    title: "Discord Nitro Gifts",
    desc: "Nitro gift links, Nitro Basic, Nitro boost codes",
  },
  {
    key: "Game",
    icon: "ticket",
    title: "Game Top-Up / Gift Cards",
    desc: "In-game currency, gift cards, top-up codes",
  },
  {
    key: "AI",
    icon: "credit-card",
    title: "Subscriptions / Memberships",
    desc: "Premium access, VPN, streaming subscriptions",
  },
  {
    key: "Software",
    icon: "shield",
    title: "Cheats / Software",
    desc: "Game cheats, tools, software with license keys",
  },
  {
    key: "Software",
    icon: "package",
    title: "Digital Downloads",
    desc: "E-books, templates, assets, files",
  },
  {
    key: "Service",
    icon: "mail",
    title: "Service",
    desc: "Manual delivery, custom work, boosting, design",
  },
  {
    key: "Software",
    icon: "zap",
    title: "Dynamic Delivery",
    desc: "Webhook-based delivery, API-generated keys",
  },
];

export const AdminProductWizard: React.FC<{ onDone: () => void; onCancel: () => void }> = ({
  onDone,
  onCancel,
}) => {
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState("");
  const [pickedTemplate, setPickedTemplate] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [priceUsd, setPriceUsd] = useState<string>("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [keysText, setKeysText] = useState("");
  const [deliverables, setDeliverables] = useState<"serials" | "service" | "dynamic">("serials");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fadeRise(stepRef.current, { duration: 380 });
  }, [step]);

  const keyCount = keysText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  const finish = async () => {
    setErr(null);
    setBusy(true);
    try {
      const p = await api.post<{ id: string }>("/api/admin/products", {
        name,
        priceUsd: Number(priceUsd) || 0,
        description,
        image,
        category,
        deliverables,
      });
      const codes = keysText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (deliverables === "serials" && codes.length)
        await api.post(`/api/admin/products/${p.id}/keys`, { codes });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create product");
      setBusy(false);
    }
  };

  return (
    <div className="pw card">
      <div className="pw-head">
        <button className="pw-x" onClick={onCancel} aria-label="Cancel">
          <Icon name="close" size={18} />
        </button>
        <div className="pw-dots">
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={`dot ${step >= n ? "on" : ""}`} />
          ))}
        </div>
      </div>

      <div className="pw-step" key={step} ref={stepRef}>
        {step === 1 && (
          <div className="pw-step-content">
            <h2 className="pw-title">What are you selling?</h2>
            <p className="pw-sub">
              Choose a template to get started quickly, or start from scratch.
            </p>
            <div className="pw-templates">
              {TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  className={`pw-tpl ${category === t.key && pickedTemplate === i ? "on" : ""}`}
                  onClick={() => {
                    setCategory(t.key);
                    setPickedTemplate(i);
                    setStep(2);
                  }}
                >
                  <Icon name={t.icon as any} size={22} variant="badge" />
                  <div className="pw-tpl-info">
                    <strong>{t.title}</strong>
                    <span>{t.desc}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="pw-scratch-wrap">
              <button
                className="pw-scratch-btn"
                onClick={() => {
                  setCategory("Software");
                  setPickedTemplate(-1);
                  setStep(2);
                }}
              >
                <Icon name="plus" size={14} /> Start from scratch
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="pw-step-content">
            <h2 className="pw-title">Name your product</h2>
            <p className="pw-sub">The title and primary details customers see in your store.</p>
            <div className="pw-form-group">
              <label className="pw-l">
                <span>Product Name</span>
                <input
                  className="input input-lg"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. ChatGPT Plus — 1 Month"
                  autoFocus
                />
              </label>

              <label className="pw-l">
                <span>Short description</span>
                <textarea
                  className="input input-lg"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What the customer gets when they buy this product…"
                />
              </label>

              <label className="pw-l">
                <span>Image URL</span>
                <input
                  className="input input-lg"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://images.unsplash.com/photo-..."
                />
              </label>
            </div>

            <div className="pw-nav">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn" disabled={!name.trim()} onClick={() => setStep(3)}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="pw-step-content">
            <h2 className="pw-title">Set your price</h2>
            <p className="pw-sub">
              Priced in USD. Customers pay the equivalent in crypto at checkout.
            </p>
            <div className="pw-price-container">
              <div className="pw-price">
                <span className="cur">$</span>
                <NumberInput decimal min={0} value={priceUsd} onChange={setPriceUsd} autoFocus />
              </div>
            </div>
            <div className="pw-nav">
              <button className="btn btn-ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="btn" disabled={!(Number(priceUsd) > 0)} onClick={() => setStep(4)}>
                Next
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="pw-step-content">
            <h2 className="pw-title">How is this delivered?</h2>
            <p className="pw-sub">Choose how customers receive the product after payment.</p>
            <div className="pw-deliv">
              {(
                [
                  {
                    key: "serials",
                    title: "Serials",
                    desc: "Auto-deliver from a list of keys you upload. Stock = number of keys.",
                    icon: "key" as const,
                    soon: false,
                  },
                  {
                    key: "service",
                    title: "Service",
                    desc: "Only sends the instructions. You fulfill manually. Stock is unlimited.",
                    icon: "ticket" as const,
                    soon: false,
                  },
                  {
                    key: "dynamic",
                    title: "Dynamic",
                    desc: "Fetch the code from a webhook URL per order. Stock is unlimited.",
                    icon: "zap" as const,
                    soon: true,
                  },
                ] as const
              ).map((d) => (
                <label
                  key={d.key}
                  className={`pw-deliv-row ${deliverables === d.key ? "on" : ""} ${d.soon ? "soon" : ""}`}
                >
                  <input
                    type="radio"
                    name="deliv"
                    checked={deliverables === d.key}
                    onChange={() => !d.soon && setDeliverables(d.key)}
                    disabled={d.soon}
                  />
                  <span className="pw-deliv-icon">
                    <Icon name={d.icon} size={24} variant="duotone-regular" />
                  </span>
                  <div className="pw-deliv-info">
                    <strong>
                      {d.title}
                      {d.soon && <span className="pw-beta">SOON</span>}
                    </strong>
                    <span>{d.desc}</span>
                  </div>
                  <span
                    className={`pw-radio ${deliverables === d.key ? "on" : ""}`}
                    aria-hidden="true"
                  />
                </label>
              ))}
            </div>

            {deliverables === "serials" && (
              <div className="pw-stock-container">
                <div className="pw-stock-head">
                  <span>Add your stock</span>
                  <span className="pw-sub">
                    Enter your keys, one per line. You can add more later.
                  </span>
                </div>
                <textarea
                  className="input pw-stock"
                  value={keysText}
                  onChange={(e) => setKeysText(e.target.value)}
                  placeholder={"KEY-AAAA-BBBB\nKEY-CCCC-DDDD\n…"}
                />
                <div className="pw-count">
                  <Icon name="box" size={14} /> {keyCount} {keyCount === 1 ? "item" : "items"}{" "}
                  entered
                </div>
              </div>
            )}
            {err && <div className="pw-err">{err}</div>}
            <div className="pw-nav">
              <button className="btn btn-ghost" onClick={() => setStep(3)}>
                Back
              </button>
              <button className="btn" onClick={finish} disabled={busy}>
                {busy ? (
                  <>
                    <Icon name="spinner" size={16} /> Publishing…
                  </>
                ) : (
                  "Publish product"
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .pw { padding: 32px 40px; max-width: 960px; margin: 20px auto; min-height: 520px; display: flex; flex-direction: column; gap: 20px; box-shadow: var(--shadow-lg); }
        .pw-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 18px; margin-bottom: 8px; }
        .pw-x { background: none; border: none; color: var(--ink-faint); cursor: pointer; display: flex; padding: 6px; border-radius: 50%; transition: background .15s; }
        .pw-x:hover { background: var(--surface-2); color: var(--ink); }
        .pw-dots { display: flex; gap: 8px; }
        .pw-dots .dot { width: 40px; height: 6px; border-radius: 100px; background: var(--line-strong); transition: background .25s var(--ease); }
        .pw-dots .dot.on { background: var(--brand); }
        .pw-step { display: flex; flex-direction: column; flex: 1; }
        .pw-step-content { display: flex; flex-direction: column; flex: 1; }
        .pw-title { font-size: 1.6rem; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
        .pw-sub { color: var(--ink-soft); font-size: 0.92rem; margin-bottom: 20px; }
        .pw-templates { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
        .pw-tpl { display: flex; align-items: center; gap: 16px; text-align: left; padding: 18px 20px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); cursor: pointer; font-family: var(--font-sans); transition: border-color .18s var(--ease), background .18s var(--ease), transform .18s var(--ease); }
        .pw-tpl:hover { border-color: var(--brand); background: var(--surface-2); transform: translateY(-1px); }
        .pw-tpl.on { border-color: var(--brand); background: var(--brand-soft, rgba(79,70,229,.08)); }
        .pw-tpl-info { display: flex; flex-direction: column; gap: 3px; }
        .pw-tpl strong { display: block; font-size: 0.96rem; font-weight: 600; color: var(--ink); }
        .pw-tpl span { font-size: .82rem; color: var(--ink-soft); line-height: 1.4; }
        
        .pw-scratch-wrap { display: flex; justify-content: center; margin-top: 10px; }
        .pw-scratch-btn { display: inline-flex; align-items: center; gap: 8px; background: none; border: none; color: var(--ink-soft); font-weight: 600; font-size: 0.88rem; cursor: pointer; padding: 10px 20px; border-radius: 8px; transition: all .15s; }
        .pw-scratch-btn:hover { color: var(--brand); background: var(--brand-soft); }
        
        .pw-form-group { display: flex; flex-direction: column; gap: 18px; margin-bottom: 24px; }
        .pw-l { display: flex; flex-direction: column; gap: 6px; font-size: .84rem; font-weight: 600; color: var(--ink-soft); }
        .pw-l span { margin-left: 2px; }
        .input-lg { padding: 12px 16px; font-size: 0.95rem; border-radius: var(--radius); }
        
        .pw-price-container { display: flex; justify-content: center; align-items: center; padding: 40px 0; margin-bottom: 20px; }
        .pw-price { display: flex; align-items: center; gap: 12px; }
        .pw-price .cur { font-size: 2.4rem; font-weight: 700; color: var(--ink-soft); }
        .pw-price input { font-size: 2rem; font-weight: 700; max-width: 260px; padding: 12px 20px; text-align: center; }
        
        .pw-stock-container { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; margin-bottom: 20px; }
        .pw-stock { min-height: 180px; font-family: monospace; font-size: .9rem; resize: vertical; padding: 14px; }
        .pw-stock-head { display: flex; flex-direction: column; gap: 2px; }
        .pw-stock-head > span:first-child { font-weight: 600; font-size: .95rem; color: var(--ink); }
        .pw-count { font-size: .82rem; color: var(--ink-faint); display: flex; align-items: center; gap: 6px; }
        
        .pw-err { background: var(--price-soft); color: var(--price); padding: 12px 16px; border-radius: var(--radius); font-size: .88rem; margin-bottom: 16px; }
        .pw-deliv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 10px 0 20px; }
        @media (max-width: 900px) { .pw-deliv { grid-template-columns: 1fr; } }
        
        .pw-deliv-row { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 24px 20px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); cursor: pointer; transition: all .18s var(--ease); position: relative; }
        .pw-deliv-row:hover:not(.soon) { border-color: var(--brand); background: var(--surface-2); }
        .pw-deliv-row.on { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent); }
        .pw-deliv-row.soon { opacity: .6; cursor: not-allowed; }
        .pw-deliv-row input { position: absolute; opacity: 0; pointer-events: none; }
        .pw-deliv-icon { width: 46px; height: 46px; border-radius: 12px; background: var(--surface-2); color: var(--ink-soft); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .18s var(--ease); }
        .pw-deliv-row.on .pw-deliv-icon { background: var(--brand); color: #fff; }
        .pw-deliv-info { display: flex; flex-direction: column; gap: 6px; align-items: center; }
        .pw-deliv-info strong { font-size: 1.05rem; font-weight: 700; color: var(--ink); display: inline-flex; align-items: center; gap: 8px; }
        .pw-deliv-info span { font-size: .82rem; color: var(--ink-soft); line-height: 1.5; }
        .pw-beta { font-size: .62rem; font-weight: 700; padding: 2px 7px; border-radius: 100px; background: var(--surface-2); color: var(--ink-soft); letter-spacing: .08em; }
        .pw-radio { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--line-strong); transition: all .18s var(--ease); }
        .pw-deliv-row.on .pw-radio { border-color: var(--brand); background: radial-gradient(circle at center, var(--brand) 0 6px, transparent 7px); }
        
        .pw-nav { display: flex; justify-content: space-between; margin-top: auto; padding-top: 20px; border-top: 1px solid var(--line); }
        
        @media (max-width: 760px) {
          .pw { padding: 20px 24px; }
          .pw-templates { grid-template-columns: 1fr; }
          .pw-deliv { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};
