import React, { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { fadeRise } from "../../lib/motion";

// Multi-step "create product" flow (template -> name -> price -> stock -> publish).
// 10 SellAuth-style templates; `category` is the default category string assigned to the product
// (until a full Categories module replaces the string column).
const TEMPLATES = [
  { key: "Software",      icon: "key",     title: "Serial / License keys", desc: "Software licenses, game keys, activation codes" },
  { key: "Entertainment", icon: "box",     title: "Accounts",              desc: "Streaming, gaming, premium accounts" },
  { key: "Game",          icon: "bolt",    title: "Discord Nitro",         desc: "Nitro gift links, Nitro Basic, boost codes" },
  { key: "Game",          icon: "zap",     title: "Game top-up / Gift cards", desc: "In-game currency, gift cards, top-up codes" },
  { key: "AI",            icon: "bolt",    title: "Subscriptions",         desc: "Premium access, VPN, streaming subscriptions" },
  { key: "Software",      icon: "shield",  title: "Cheats / Software",     desc: "Game cheats, tools, software with license keys" },
  { key: "Software",      icon: "box",     title: "Digital Downloads",     desc: "E-books, templates, assets, files" },
  { key: "Service",       icon: "ticket",  title: "Service",               desc: "Manual delivery, custom work, boosting, design" },
  { key: "Software",      icon: "zap",     title: "Dynamic Delivery",      desc: "Webhook-based delivery, API-generated keys" },
  { key: "Software",      icon: "plus",    title: "Start from scratch",    desc: "Blank template — pick your own category & settings" },
];

export const AdminProductWizard: React.FC<{ onDone: () => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
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

  useEffect(() => { fadeRise(stepRef.current, { duration: 380 }); }, [step]);

  const keyCount = keysText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length;

  const finish = async () => {
    setErr(null); setBusy(true);
    try {
      const p = await api.post<{ id: string }>("/api/admin/products", { name, priceUsd: Number(priceUsd) || 0, description, image, category, deliverables });
      const codes = keysText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (deliverables === "serials" && codes.length) await api.post(`/api/admin/products/${p.id}/keys`, { codes });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create product");
      setBusy(false);
    }
  };

  return (
    <div className="pw card">
      <div className="pw-head">
        <button className="pw-x" onClick={onCancel} aria-label="Cancel"><Icon name="close" size={18} /></button>
        <div className="pw-dots">{[1, 2, 3, 4].map((n) => <span key={n} className={`dot ${step >= n ? "on" : ""}`} />)}</div>
      </div>

      <div className="pw-step" key={step} ref={stepRef}>
        {step === 1 && (
          <>
            <h2>What are you selling?</h2>
            <p className="pw-sub">Pick a template to start. It just preselects a category — you can change everything.</p>
            <div className="pw-templates">
              {TEMPLATES.map((t, i) => (
                <button key={i} className={`pw-tpl ${category === t.key && pickedTemplate === i ? "on" : ""}`} onClick={() => { setCategory(t.key); setPickedTemplate(i); setStep(2); }}>
                  <Icon name={t.icon as any} size={20} variant="badge" />
                  <div><strong>{t.title}</strong><span>{t.desc}</span></div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Name your product</h2>
            <p className="pw-sub">The title customers see in your store.</p>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ChatGPT Plus — 1 Month" autoFocus />
            <label className="pw-l"><span>Short description</span>
              <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the customer gets…" />
            </label>
            <label className="pw-l"><span>Image URL</span>
              <input className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
            </label>
            <div className="pw-nav"><button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button><button className="btn" disabled={!name.trim()} onClick={() => setStep(3)}>Next</button></div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Set your price</h2>
            <p className="pw-sub">Priced in USD. Customers pay the equivalent in crypto at checkout.</p>
            <div className="pw-price">
              <span className="cur">$</span>
              <NumberInput decimal min={0} value={priceUsd} onChange={setPriceUsd} autoFocus />
            </div>
            <div className="pw-nav"><button className="btn btn-ghost" onClick={() => setStep(2)}>Back</button><button className="btn" disabled={!(Number(priceUsd) > 0)} onClick={() => setStep(4)}>Next</button></div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>How is this delivered?</h2>
            <p className="pw-sub">Choose how customers receive the product after payment.</p>
            <div className="pw-deliv">
              {([
                { key: "serials",  title: "Serials",  desc: "Auto-deliver from a list of keys you upload. Stock = number of keys.",  icon: "key" as const,    soon: false },
                { key: "service",  title: "Service",  desc: "Only sends the instructions. You fulfill manually. Stock is unlimited.", icon: "ticket" as const, soon: false },
                { key: "dynamic",  title: "Dynamic",  desc: "Fetch the code from a webhook URL per order. Stock is unlimited.",       icon: "bolt" as const,   soon: true  },
              ] as const).map((d) => (
                <label key={d.key} className={`pw-deliv-row ${deliverables === d.key ? "on" : ""} ${d.soon ? "soon" : ""}`}>
                  <input type="radio" name="deliv" checked={deliverables === d.key} onChange={() => !d.soon && setDeliverables(d.key)} disabled={d.soon} />
                  <span className="pw-deliv-icon"><Icon name={d.icon} size={18} variant="duotone-regular" /></span>
                  <div className="pw-deliv-info">
                    <strong>{d.title}{d.soon && <span className="pw-beta">SOON</span>}</strong>
                    <span>{d.desc}</span>
                  </div>
                  <span className={`pw-radio ${deliverables === d.key ? "on" : ""}`} aria-hidden="true" />
                </label>
              ))}
            </div>

            {deliverables === "serials" && (
              <>
                <div className="pw-stock-head">
                  <span>Add your stock</span>
                  <span className="pw-sub">Enter your keys, one per line. You can add more later.</span>
                </div>
                <textarea className="input pw-stock" value={keysText} onChange={(e) => setKeysText(e.target.value)} placeholder={"KEY-AAAA-BBBB\nKEY-CCCC-DDDD\n…"} />
                <div className="pw-count"><Icon name="box" size={14} /> {keyCount} {keyCount === 1 ? "item" : "items"} entered</div>
              </>
            )}
            {err && <div className="pw-err">{err}</div>}
            <div className="pw-nav">
              <button className="btn btn-ghost" onClick={() => setStep(3)}>Back</button>
              <button className="btn" onClick={finish} disabled={busy}>{busy ? <><Icon name="spinner" size={16} /> Publishing…</> : "Publish product"}</button>
            </div>
          </>
        )}
      </div>

      <style>{`
        .pw { padding: 22px 26px 26px; max-width: 620px; margin: 0 auto; }
        .pw-head { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
        .pw-x { background: none; border: none; color: var(--ink-faint); cursor: pointer; display: flex; }
        .pw-dots { display: flex; gap: 8px; }
        .pw-dots .dot { width: 30px; height: 5px; border-radius: 100px; background: var(--line-strong); transition: background .2s; }
        .pw-dots .dot.on { background: var(--brand); }
        .pw-step { display: flex; flex-direction: column; gap: 12px; }
        .pw-step h2 { font-size: 1.3rem; }
        .pw-sub { color: var(--ink-soft); font-size: .88rem; margin-top: -6px; }
        .pw-templates { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 6px; }
        @media (max-width: 760px) { .pw-templates { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 480px) { .pw-templates { grid-template-columns: 1fr; } }
        .pw-tpl { display: flex; align-items: center; gap: 12px; text-align: left; padding: 14px; border: 1.5px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; font-family: var(--font-sans); transition: border-color .16s, background .16s; }
        .pw-tpl:hover { border-color: var(--brand); }
        .pw-tpl.on { border-color: var(--brand); background: var(--brand-soft, rgba(79,70,229,.08)); }
        .pw-tpl strong { display: block; font-size: .9rem; }
        .pw-tpl span { font-size: .76rem; color: var(--ink-faint); }
        .pw-l { display: flex; flex-direction: column; gap: 5px; font-size: .8rem; font-weight: 600; color: var(--ink-soft); }
        .pw-price { display: flex; align-items: center; gap: 8px; }
        .pw-price .cur { font-size: 1.8rem; font-weight: 700; color: var(--ink-soft); }
        .pw-price input { font-size: 1.4rem; font-weight: 700; max-width: 200px; }
        .pw-stock { min-height: 160px; font-family: monospace; font-size: .85rem; resize: vertical; }
        .pw-stock-head { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; }
        .pw-stock-head > span:first-child { font-weight: 600; font-size: .9rem; color: var(--ink); }
        .pw-count { font-size: .8rem; color: var(--ink-faint); display: flex; align-items: center; gap: 6px; }
        .pw-err { background: var(--price-soft); color: var(--price); padding: 9px 12px; border-radius: var(--radius-sm); font-size: .84rem; }
        .pw-deliv { display: flex; flex-direction: column; gap: 10px; margin: 4px 0 10px; }
        .pw-deliv-row { display: flex; flex-direction: row; align-items: flex-start; gap: 14px; padding: 16px 18px; border: 1.5px solid var(--line); border-radius: var(--radius); background: var(--surface); cursor: pointer; transition: border-color .18s var(--ease), background .18s var(--ease), box-shadow .18s var(--ease); position: relative; }
        .pw-deliv-row:hover:not(.soon) { border-color: var(--brand); background: color-mix(in srgb, var(--brand-soft) 50%, transparent); }
        .pw-deliv-row.on { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent); }
        .pw-deliv-row.soon { opacity: .6; cursor: not-allowed; }
        .pw-deliv-row input { position: absolute; opacity: 0; pointer-events: none; }
        .pw-deliv-icon { width: 38px; height: 38px; border-radius: 10px; background: var(--surface-2); color: var(--ink-soft); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background .18s var(--ease), color .18s var(--ease); }
        .pw-deliv-row.on .pw-deliv-icon { background: var(--brand); color: #fff; }
        .pw-deliv-info { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .pw-deliv-info strong { font-size: .95rem; font-weight: 700; color: var(--ink); display: inline-flex; align-items: center; gap: 8px; }
        .pw-deliv-info span { font-size: .82rem; color: var(--ink-faint); line-height: 1.5; }
        .pw-beta { font-size: .62rem; font-weight: 700; padding: 2px 7px; border-radius: 100px; background: var(--surface-2); color: var(--ink-soft); letter-spacing: .08em; }
        .pw-radio { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--line-strong); flex-shrink: 0; transition: border-color .18s var(--ease), background .18s var(--ease); margin-top: 9px; }
        .pw-deliv-row.on .pw-radio, .pw-radio.on { border-color: var(--brand); background: radial-gradient(circle at center, var(--brand) 0 6px, transparent 7px); }
        .pw-nav { display: flex; justify-content: space-between; margin-top: 10px; }
        @media (max-width: 560px) { .pw-templates { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};
