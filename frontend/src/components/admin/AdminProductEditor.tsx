import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Checkbox } from "../Checkbox";
import { Dropdown } from "../Dropdown";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";

/**
 * SellAuth-style full-page product editor with a tab bar.
 * Tabs: General | Pricing & Stock | SEO | Visibility.
 *
 * `productId` null = create mode; otherwise edit mode (we fetch the row).
 * `onDone` is called after a successful save or cancel.
 */
export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceUsd: number;
  compareAtPrice?: number | null;
  image: string;
  category: string;
  categoryId: string | null;
  active: boolean;
  sold: number;
  available: number;
  delivered: number;
  deliverables: "serials" | "service" | "dynamic";
  variants?: { id: string; name: string; priceUsd: number; compareAtPrice: number | null }[];
}

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

type Tab = "general" | "pricing" | "seo" | "visibility";

interface FormState {
  name: string;
  slug: string;
  description: string;
  image: string;
  priceUsd: string; // string for NumberInput
  compareAtPrice: string; // string for NumberInput
  category: string; // legacy free text
  categoryId: string; // FK (preferred); "" = none
  deliverables: "serials" | "service" | "dynamic";
  active: boolean;
}

const initialForm = (p?: ProductRow): FormState => ({
  name: p?.name ?? "",
  slug: p?.slug ?? "",
  description: p?.description ?? "",
  image: p?.image ?? "",
  priceUsd: p ? String(p.priceUsd) : "",
  compareAtPrice: p?.compareAtPrice ? String(p.compareAtPrice) : "",
  category: p?.category ?? "",
  categoryId: p?.categoryId ?? "",
  deliverables: p?.deliverables ?? "serials",
  active: p?.active ?? true,
});

export const AdminProductEditor: React.FC<{
  product: ProductRow | null;
  onDone: (msg?: string) => void;
}> = ({ product, onDone }) => {
  const [tab, setTab] = useState<Tab>("general");
  const [form, setForm] = useState<FormState>(initialForm(product ?? undefined));
  const [variants, setVariants] = useState<
    { id?: string; name: string; priceUsd: string; compareAtPrice: string }[]
  >(
    product?.variants?.map((v) => ({
      id: v.id,
      name: v.name,
      priceUsd: String(v.priceUsd),
      compareAtPrice: v.compareAtPrice ? String(v.compareAtPrice) : "",
    })) ?? [],
  );
  const [cats, setCats] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Category[]>("/api/admin/categories")
      .then(setCats)
      .catch(() => setCats([]));
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async (closeAfter: boolean) => {
    setErr(null);
    setBusy(true);
    try {
      // If categoryId is chosen, mirror its name into the legacy `category` field for back-compat.
      const cat = cats.find((c) => c.id === form.categoryId);
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        image: form.image,
        priceUsd: Number(form.priceUsd) || 0,
        compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
        category: cat?.name || form.category || "Uncategorized",
        categoryId: form.categoryId || null,
        deliverables: form.deliverables,
        active: form.active,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceUsd: Number(v.priceUsd) || 0,
          compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
        })),
      };
      if (form.slug.trim()) payload.slug = form.slug.trim();
      if (product) await api.patch(`/api/admin/products/${product.id}`, payload);
      else await api.post("/api/admin/products", payload);
      onDone(closeAfter ? (product ? "Product saved." : "Product created.") : undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "general", label: "General", icon: "box" },
    { key: "pricing", label: "Pricing & Stock", icon: "receipt" },
    { key: "seo", label: "SEO", icon: "zap" },
    { key: "visibility", label: "Visibility", icon: "key" },
  ];

  return (
    <div className="pe">
      <header className="pe-head">
        <div>
          <h1>{product ? "Edit product" : "Create product"}</h1>
          <p className="muted">
            {product
              ? `Editing "${product.name}". Changes save instantly.`
              : "Fill in the details below to create a new product."}
          </p>
        </div>
        <div className="pe-actions">
          <button className="btn btn-ghost" onClick={() => onDone()} type="button">
            <Icon name="close" size={15} /> Cancel
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => save(false)}
            disabled={busy}
            type="button"
          >
            <Icon name="check" size={15} /> Save
          </button>
          <button
            className="btn"
            onClick={() => save(true)}
            disabled={busy || !form.name.trim()}
            type="button"
          >
            {busy ? (
              <>
                <Icon name="spinner" size={15} className="is-spinning" /> Saving…
              </>
            ) : (
              <>
                <Icon name="check" size={15} /> Save & Exit
              </>
            )}
          </button>
        </div>
      </header>

      <nav className="pe-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`pe-tab ${tab === t.key ? "on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </nav>

      {err && <div className="pe-err">{err}</div>}

      {tab === "general" && (
        <section className="pe-pane card">
          <h3>
            <Icon name="box" size={16} variant="badge" /> General
          </h3>
          <div className="grid-2">
            <label>
              <span>Name</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <label>
              <span>
                URL path <em>(optional)</em>
              </span>
              <input
                className="input"
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                placeholder={
                  form.name
                    ? form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
                    : "product-url-path"
                }
              />
            </label>
          </div>
          <label>
            <span>Category</span>
            <Dropdown<string>
              value={form.categoryId}
              onChange={(v) => set("categoryId", v)}
              options={[
                { value: "", label: "— Uncategorized —", icon: "box" },
                ...cats.map((c) => ({ value: c.id, label: c.name, icon: "box" as const })),
              ]}
              width="100%"
            />
          </label>
          <label>
            <span>Image URL</span>
            <input
              className="input"
              value={form.image}
              onChange={(e) => set("image", e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={4}
              placeholder="Describe what the customer is buying…"
            />
          </label>

          <h3 className="sub">
            <Icon name="key" size={16} variant="badge" /> Delivery method
          </h3>
          <p className="hint">How does this product get delivered to the customer after payment?</p>
          <div className="pe-deliv">
            {(
              [
                {
                  key: "serials",
                  title: "Serials",
                  desc: "Auto-deliver from a list of keys you upload. Stock equals the number of unused keys.",
                  icon: "key" as const,
                  soon: false,
                },
                {
                  key: "service",
                  title: "Service",
                  desc: "Only sends the instructions you wrote above. You fulfill the order manually. Stock is unlimited.",
                  icon: "ticket" as const,
                  soon: false,
                },
                {
                  key: "dynamic",
                  title: "Dynamic",
                  desc: "Fetch a fresh code from a webhook URL per order. Stock is unlimited.",
                  icon: "bolt" as const,
                  soon: true,
                },
              ] as const
            ).map((d) => (
              <label
                key={d.key}
                className={`pe-deliv-row ${form.deliverables === d.key ? "on" : ""} ${d.soon ? "soon" : ""}`}
              >
                <input
                  type="radio"
                  name="deliv"
                  checked={form.deliverables === d.key}
                  disabled={d.soon}
                  onChange={() => !d.soon && set("deliverables", d.key)}
                />
                <span className="pe-deliv-icon">
                  <Icon name={d.icon} size={18} variant="duotone-regular" />
                </span>
                <div className="pe-deliv-info">
                  <strong>
                    {d.title}
                    {d.soon && <span className="pe-beta">SOON</span>}
                  </strong>
                  <span>{d.desc}</span>
                </div>
                <span
                  className={`pe-radio ${form.deliverables === d.key ? "on" : ""}`}
                  aria-hidden="true"
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {tab === "pricing" && (
        <section className="pe-pane card">
          <h3>
            <Icon name="receipt" size={16} variant="badge" /> Pricing & Stock
          </h3>
          <div className="grid-2">
            <label>
              <span>Price (USD)</span>
              <NumberInput
                decimal
                min={0}
                value={form.priceUsd}
                onChange={(v) => set("priceUsd", v)}
              />
            </label>
            <label>
              <span>
                Compare-at Price (USD) <em>(optional)</em>
              </span>
              <NumberInput
                decimal
                min={0}
                value={form.compareAtPrice}
                onChange={(v) => set("compareAtPrice", v)}
              />
            </label>
          </div>
          <div className="kv-row">
            <div className="kv">
              <span className="kv-label">Available stock</span>
              <span className="kv-val">
                {product ? `${product.available} keys` : "Add keys after creating"}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">Sold</span>
              <span className="kv-val">{product?.sold ?? 0}</span>
            </div>
          </div>

          <h3
            className="sub"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignValues: "center",
              paddingTop: "14px",
              borderTop: "1px solid var(--line)",
              marginTop: "6px",
            }}
          >
            <span>
              <Icon name="receipt" size={16} variant="badge" /> Product Variants
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setVariants([...variants, { name: "", priceUsd: "", compareAtPrice: "" }])
              }
              type="button"
            >
              + Add Variant
            </button>
          </h3>
          <p className="hint">
            If variants are configured, customers will choose a variant at checkout. Each variant
            will have its own keys pool.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {variants.map((v, i) => (
              <div key={i} className="pe-variant-row">
                <label>
                  <span>Variant Name</span>
                  <input
                    className="input"
                    value={v.name}
                    onChange={(e) => {
                      const next = [...variants];
                      next[i].name = e.target.value;
                      setVariants(next);
                    }}
                    placeholder="e.g. 1 Month"
                  />
                </label>
                <label>
                  <span>Price (USD)</span>
                  <NumberInput
                    decimal
                    min={0}
                    value={v.priceUsd}
                    onChange={(val) => {
                      const next = [...variants];
                      next[i].priceUsd = val;
                      setVariants(next);
                    }}
                  />
                </label>
                <label>
                  <span>Compare-at Price</span>
                  <NumberInput
                    decimal
                    min={0}
                    value={v.compareAtPrice}
                    onChange={(val) => {
                      const next = [...variants];
                      next[i].compareAtPrice = val;
                      setVariants(next);
                    }}
                  />
                </label>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "4px" }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "8px", color: "var(--price)" }}
                    onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                    type="button"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {product && (
            <p className="hint" style={{ marginTop: "10px" }}>
              Manage the key inventory from the product list (Keys button on the row).
            </p>
          )}
        </section>
      )}

      {tab === "seo" && (
        <section className="pe-pane card">
          <h3>
            <Icon name="zap" size={16} variant="badge" /> SEO
          </h3>
          <p className="hint">URL slug feeds search engines and shapes the product page URL.</p>
          <label>
            <span>URL path (slug)</span>
            <input
              className="input"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              placeholder={
                form.name ? form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "product-url-path"
              }
            />
          </label>
          <div className="kv-row">
            <div className="kv">
              <span className="kv-label">Public URL</span>
              <span className="kv-val mono">
                /product/
                {form.slug ||
                  (form.name ? form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "—")}
              </span>
            </div>
          </div>
        </section>
      )}

      {tab === "visibility" && (
        <section className="pe-pane card">
          <h3>
            <Icon name="key" size={16} variant="badge" /> Visibility
          </h3>
          <div className="row-toggle">
            <Checkbox checked={form.active} onChange={(v) => set("active", v)} size={22} />
            <div>
              <strong>Active</strong>
              <span>
                {form.active
                  ? "Visible on the storefront."
                  : "Hidden from the storefront. Existing orders are unaffected."}
              </span>
            </div>
          </div>
        </section>
      )}

      <style>{`
        .pe { display: flex; flex-direction: column; gap: 16px; }
        .pe-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
        .pe-head h1 { font-size: 1.5rem; font-weight: 700; color: var(--ink); }
        .pe-head .muted { font-size: .84rem; color: var(--ink-soft); margin-top: 4px; }
        .pe-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .pe-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 2px; overflow-x: auto; }
        .pe-tab { display: inline-flex; align-items: center; gap: 7px; background: none; border: none; color: var(--ink-soft); font-family: var(--font-sans); font-weight: 600; font-size: .88rem; padding: 10px 14px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s, border-color .15s; }
        .pe-tab:hover { color: var(--ink); }
        .pe-tab.on { color: var(--brand); border-bottom-color: var(--brand); }
        .pe-err { background: var(--price-soft); color: var(--price); padding: 9px 12px; border-radius: var(--radius-sm); font-size: .84rem; }
        .pe-pane { padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; }
        .pe-pane h3 { display: flex; align-items: center; gap: 10px; font-size: 1.02rem; font-weight: 700; color: var(--ink); }
        .pe-pane h3.sub { padding-top: 14px; border-top: 1px solid var(--line); margin-top: 6px; }
        .pe-pane label { display: flex; flex-direction: column; gap: 5px; font-size: .85rem; font-weight: 600; color: var(--ink-soft); }
        .pe-pane label em { font-weight: 400; color: var(--ink-faint); font-style: normal; }
        .pe-pane textarea { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 10px 12px; font-family: var(--font-sans); font-size: .9rem; color: var(--ink); background: var(--surface-2); outline: none; }
        .pe-pane textarea:focus { border-color: var(--brand); }
        .pe-pane select { cursor: pointer; }
        .pe-pane .hint { font-size: .82rem; color: var(--ink-faint); }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .kv { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; background: var(--surface-2); border-radius: var(--radius-sm); }
        .kv-label { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); font-weight: 600; }
        .kv-val { font-size: .92rem; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
        .kv-val.mono { font-family: monospace; font-weight: 400; }
        .kv-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        .pe-deliv { display: flex; flex-direction: column; gap: 10px; }
        label.pe-deliv-row { display: flex; flex-direction: row; align-items: flex-start; gap: 14px; padding: 16px 18px; border: 1.5px solid var(--line); border-radius: var(--radius); background: var(--surface); cursor: pointer; transition: border-color .18s var(--ease), background .18s var(--ease), box-shadow .18s var(--ease); position: relative; }
        .pe-deliv-row:hover:not(.soon) { border-color: var(--brand); background: color-mix(in srgb, var(--brand-soft) 50%, transparent); }
        .pe-deliv-row.on { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent); }
        .pe-deliv-row.soon { opacity: .6; cursor: not-allowed; }
        .pe-deliv-row input { position: absolute; opacity: 0; pointer-events: none; }
        .pe-deliv-icon { width: 38px; height: 38px; border-radius: 10px; background: var(--surface-2); color: var(--ink-soft); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background .18s var(--ease), color .18s var(--ease); }
        .pe-deliv-row.on .pe-deliv-icon { background: var(--brand); color: #fff; }
        .pe-deliv-info { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .pe-deliv-info strong { font-size: .95rem; font-weight: 700; color: var(--ink); display: inline-flex; align-items: center; gap: 8px; }
        .pe-deliv-info span { font-size: .82rem; color: var(--ink-faint); line-height: 1.5; }
        .pe-beta { font-size: .62rem; font-weight: 700; padding: 2px 7px; border-radius: 100px; background: var(--surface-2); color: var(--ink-soft); letter-spacing: .08em; }
        .pe-radio { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--line-strong); flex-shrink: 0; transition: border-color .18s var(--ease), background .18s var(--ease); margin-top: 9px; }
        .pe-deliv-row.on .pe-radio, .pe-radio.on { border-color: var(--brand); background: radial-gradient(circle at center, var(--brand) 0 6px, transparent 7px); }

        .row-toggle { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); flex-direction: row; }
        .row-toggle strong { display: block; font-size: .92rem; color: var(--ink); }
        .row-toggle span { display: block; font-size: .78rem; color: var(--ink-faint); margin-top: 2px; }

        .pe-variant-row { display: grid; grid-template-columns: 1.5fr 1fr 1fr auto; gap: 10px; align-items: flex-end; border: 1px solid var(--line); padding: 12px; border-radius: var(--radius-sm); }
        @media (max-width: 720px) {
          .grid-2, .kv-row { grid-template-columns: 1fr; }
          .pe-head { flex-direction: column; align-items: stretch; }
          .pe-variant-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};
