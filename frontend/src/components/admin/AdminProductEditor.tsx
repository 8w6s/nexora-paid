import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Dropdown } from "../Dropdown";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { RichTextEditor } from "../RichTextEditor";
import { useToast } from "../Toast";
import { ImagePicker } from "./ImagePicker";

/**
 * SellAuth-style full-page product editor with a tab bar.
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

type Tab =
  | "general"
  | "pricing"
  | "custom_fields"
  | "addons"
  | "seo"
  | "visibility"
  | "financials"
  | "statistics"
  | "discord"
  | "developer"
  | "miscellaneous";

interface CustomField {
  key: string;
  label: string;
  type: "text" | "number" | "checkbox" | "select";
  options?: string;
  required: boolean;
}
interface ProductAddon {
  id: string;
  name: string;
  priceUsd: number;
}

interface FormState {
  name: string;
  slug: string;
  description: string;
  instructions: string;
  image: string;
  priceUsd: string;
  compareAtPrice: string;
  category: string;
  categoryId: string;
  deliverables: "serials" | "service" | "dynamic";
  active: boolean;
  // SEO
  metaTitle: string;
  metaDescription: string;
  // Visibility
  showWhenOutOfStock: boolean;
  requireEmailVerification: boolean;
  limitPerCustomer: string;
  // Financials
  payoutTaxPercent: string;
  // Discord
  discordRoleId: string;
  discordServerId: string;
  // Developer
  webhookUrl: string;
  // Misc
  sortOrder: string;
  featured: boolean;
  minOrderQty: string;
  maxOrderQty: string;
  warrantyDays: string;
}

const initialForm = (p?: ProductRow): FormState => ({
  name: p?.name ?? "",
  slug: p?.slug ?? "",
  description: p?.description ?? "",
  instructions: "",
  image: p?.image ?? "",
  priceUsd: p ? String(p.priceUsd) : "",
  compareAtPrice: p?.compareAtPrice ? String(p.compareAtPrice) : "",
  category: p?.category ?? "",
  categoryId: p?.categoryId ?? "",
  deliverables: p?.deliverables ?? "serials",
  active: p?.active ?? true,
  metaTitle: "",
  metaDescription: "",
  showWhenOutOfStock: false,
  requireEmailVerification: false,
  limitPerCustomer: "",
  payoutTaxPercent: "",
  discordRoleId: "",
  discordServerId: "",
  webhookUrl: "",
  sortOrder: "",
  featured: false,
  minOrderQty: "1",
  maxOrderQty: "",
  warrantyDays: "",
});

// RichTextEditor is imported from ../RichTextEditor

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
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [availableAddons, setAvailableAddons] = useState<ProductAddon[]>([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    api
      .get<Category[]>("/api/admin/categories", { signal: ac.signal })
      .then((d) => alive && setCats(d))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (alive) setCats([]);
      });
    api
      .get<ProductAddon[]>("/api/admin/addons", { signal: ac.signal })
      .then((d) => alive && setAvailableAddons(d))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // ignore — addons are optional
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async (closeAfter: boolean) => {
    setErr(null);
    setBusy(true);
    try {
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

  const tabsList: { key: Tab; label: string; icon: any }[] = [
    { key: "general", label: "General", icon: "folder" },
    { key: "pricing", label: "Pricing & Stock", icon: "credit-card" },
    { key: "custom_fields", label: "Custom Fields", icon: "settings" },
    { key: "addons", label: "Addons & Upsells", icon: "tag" },
    { key: "seo", label: "SEO", icon: "search" },
    { key: "visibility", label: "Visibility", icon: "shield" },
    { key: "financials", label: "Financials", icon: "activity" },
    { key: "statistics", label: "Statistics", icon: "activity" },
    { key: "discord", label: "Discord", icon: "bell" },
    { key: "developer", label: "Developer", icon: "zap" },
    { key: "miscellaneous", label: "Miscellaneous", icon: "settings" },
  ];

  return (
    <div className="pe">
      <header className="pe-head">
        <div>
          <h1>{product ? "Edit Product" : "Create Product"}</h1>
          <p className="muted">
            {product
              ? `Fill in the details below to edit product.`
              : "Fill in the details below to create a new product."}
          </p>
        </div>
        <div className="pe-actions">
          <button className="btn btn-ghost pe-btn-cancel" onClick={() => onDone()} type="button">
            <Icon name="close" size={14} /> Cancel
          </button>
          <button
            className="btn btn-outline pe-btn-save"
            onClick={() => save(false)}
            disabled={busy}
            type="button"
          >
            <Icon name="copy" size={14} /> Create & Exit
          </button>
          <button
            className="btn pe-btn-create"
            onClick={() => save(true)}
            disabled={busy || !form.name.trim()}
            type="button"
          >
            {busy ? (
              <>
                <Icon name="spinner" size={14} className="is-spinning" /> Saving…
              </>
            ) : (
              <>
                <Icon name="check" size={14} /> {product ? "Save Product" : "Create"}
              </>
            )}
          </button>
        </div>
      </header>

      <div className="pe-alert-banner">
        <Icon name="bell" size={16} />
        <span>
          Before adding a product, please review our{" "}
          <a href="#" onClick={(e) => e.preventDefault()}>
            Acceptable Use Policy
          </a>{" "}
          to ensure it's permitted.
        </span>
      </div>

      <nav className="pe-tabs">
        {tabsList.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`pe-tab ${tab === t.key ? "on" : ""}`}
            onClick={() => setTab(t.key)}
            type="button"
          >
            {t.icon && <Icon name={t.icon} size={14} />} {t.label}
          </button>
        ))}
      </nav>

      {err && <div className="pe-err">{err}</div>}

      {tab === "general" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="folder" size={18} />
            <h3>General</h3>
          </div>

          <div className="pe-form-row">
            <label className="pe-field-label">
              <span>Name</span>
              <input
                className="input input-lg"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Product Name"
              />
            </label>
          </div>

          <div className="pe-form-row">
            <label className="pe-field-label">
              <span>
                URL Path <em>(optional)</em>
              </span>
              <input
                className="input input-lg"
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

          <div className="pe-form-row">
            <label className="pe-field-label">
              <span>Description</span>
            </label>
            <RichTextEditor
              value={form.description}
              onChange={(v) => set("description", v)}
              placeholder="Describe your product..."
              minRows={6}
            />
          </div>

          <div className="pe-form-row">
            <label className="pe-field-label">
              <span>
                Category <em>(optional)</em>
              </span>
              <Dropdown<string>
                value={form.categoryId}
                onChange={(v) => set("categoryId", v)}
                options={[
                  { value: "", label: "Select...", icon: "folder" },
                  ...cats.map((c) => ({ value: c.id, label: c.name, icon: "folder" as const })),
                ]}
                width="100%"
              />
            </label>
          </div>

          <div className="pe-form-row">
            <label className="pe-field-label">
              <span>Product image</span>
              <ImagePicker value={form.image} onChange={(u) => set("image", u)} />
            </label>
          </div>

          <div className="pe-form-row">
            <label className="pe-field-label">
              <span>Instructions</span>
              <span className="pe-field-sub">
                This will be shown to the customer on invoice page & in email.
              </span>
            </label>
            <RichTextEditor
              value={form.instructions}
              onChange={(v) => set("instructions", v)}
              placeholder="To use this product, follow these instructions..."
              minRows={4}
            />
          </div>

          <div className="pe-deliverables-section">
            <h4>Deliverables Type</h4>
            <span className="pe-field-sub">
              This will determine how the product is delivered to the customer and how the stock is
              managed.
            </span>

            <div className="pe-deliv-options">
              {[
                {
                  key: "serials" as const,
                  title: "Serials",
                  desc: "Automatically delivers serial keys. Stock count is based on the number of entered serials.",
                  icon: "key" as const,
                },
                {
                  key: "service" as const,
                  title: "Service",
                  desc: "Automatically delivers ONLY Instructions. Stock count is entered manually and can be infinite.",
                  icon: "ticket" as const,
                },
                {
                  key: "dynamic" as const,
                  title: "Dynamic",
                  desc: "Automatically delivers content from a specified webhook URL. Stock count is entered manually and can be infinite.",
                  icon: "zap" as const,
                },
              ].map((d) => (
                <label
                  key={d.key}
                  className={`pe-deliv-card ${form.deliverables === d.key ? "on" : ""}`}
                >
                  <input
                    type="radio"
                    name="deliv"
                    checked={form.deliverables === d.key}
                    onChange={() => set("deliverables", d.key)}
                  />
                  <span
                    className={`pe-radio-selector ${form.deliverables === d.key ? "on" : ""}`}
                  />
                  <div className="pe-deliv-card-content">
                    <strong>{d.title}</strong>
                    <span>{d.desc}</span>
                  </div>
                  <Icon name={d.icon} size={18} />
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "pricing" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="credit-card" size={18} />
            <h3>Pricing & Stock</h3>
          </div>

          <div className="pe-variant-card-container">
            <div className="pe-variant-header-row">
              <span className="pe-variant-title">Default</span>
            </div>

            <div className="grid-2" style={{ padding: "16px 20px" }}>
              <label className="pe-field-label">
                <span>Price (USD)</span>
                <NumberInput
                  decimal
                  min={0}
                  value={form.priceUsd}
                  onChange={(v) => set("priceUsd", v)}
                />
              </label>
              <label className="pe-field-label">
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

            <div className="kv-row" style={{ padding: "0 20px 20px" }}>
              <div className="kv">
                <span className="kv-label">Available Stock</span>
                <span className="kv-val">
                  {product ? `${product.available} keys` : "Add keys after creating"}
                </span>
              </div>
              <div className="kv">
                <span className="kv-label">Sold</span>
                <span className="kv-val">{product?.sold ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="pe-variants-section">
            <div className="pe-variants-header">
              <h4>Product Variants</h4>
              <button
                className="btn btn-outline btn-sm"
                onClick={() =>
                  setVariants([...variants, { name: "", priceUsd: "", compareAtPrice: "" }])
                }
                type="button"
              >
                + Create a New Variant
              </button>
            </div>
            <p className="pe-field-sub">
              If variants are configured, customers will choose a variant at checkout. Each variant
              will have its own keys pool.
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}
            >
              {variants.map((v, i) => (
                <div key={i} className="pe-variant-editor-row">
                  <label className="pe-field-label">
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
                  <label className="pe-field-label">
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
                  <label className="pe-field-label">
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
                  <button
                    className="btn btn-ghost btn-danger-icon"
                    onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                    type="button"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───── Custom Fields ───── */}
      {tab === "custom_fields" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="settings" size={18} />
            <h3>Custom Fields</h3>
          </div>
          <p className="pe-field-sub">
            Custom fields are displayed to customers at checkout and visible on the invoice.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {customFields.map((f, i) => (
              <div key={i} className="pe-cf-row">
                <label className="pe-field-label" style={{ flex: 1 }}>
                  Label
                  <input
                    className="input"
                    value={f.label}
                    onChange={(e) => {
                      const n = [...customFields];
                      n[i].label = e.target.value;
                      setCustomFields(n);
                    }}
                    placeholder="e.g. Discord Username"
                  />
                </label>
                <label className="pe-field-label">
                  Type
                  <select
                    className="input"
                    value={f.type}
                    onChange={(e) => {
                      const n = [...customFields];
                      n[i].type = e.target.value as CustomField["type"];
                      setCustomFields(n);
                    }}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="select">Dropdown</option>
                  </select>
                </label>
                <label
                  className="pe-field-label"
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingTop: 22,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => {
                      const n = [...customFields];
                      n[i].required = e.target.checked;
                      setCustomFields(n);
                    }}
                  />
                  Required
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger-icon"
                  style={{ alignSelf: "flex-end" }}
                  onClick={() => setCustomFields((cf) => cf.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginTop: 12, alignSelf: "flex-start" }}
            onClick={() =>
              setCustomFields((cf) => [
                ...cf,
                { key: `field_${Date.now()}`, label: "", type: "text", required: false },
              ])
            }
          >
            <Icon name="plus" size={13} /> Add Field
          </button>
        </section>
      )}

      {/* ───── Addons & Upsells ───── */}
      {tab === "addons" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="tag" size={18} />
            <h3>Addons & Upsells</h3>
          </div>
          <p className="pe-field-sub">
            Select which addons are available for customers to add on this product's page.
          </p>
          {availableAddons.length === 0 ? (
            <p className="pe-field-sub" style={{ marginTop: 16 }}>
              No addons created yet.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onDone();
                }}
                style={{ color: "var(--brand)" }}
              >
                Go to Addons
              </a>{" "}
              to create some.
            </p>
          ) : (
            <div className="pe-addon-grid">
              {availableAddons.map((a) => (
                <label
                  key={a.id}
                  className={`pe-addon-card ${selectedAddonIds.includes(a.id) ? "on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedAddonIds.includes(a.id)}
                    onChange={() =>
                      setSelectedAddonIds((ids) =>
                        ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id],
                      )
                    }
                    style={{ display: "none" }}
                  />
                  <span className="pe-addon-check">
                    {selectedAddonIds.includes(a.id) ? <Icon name="check" size={11} /> : null}
                  </span>
                  <strong>{a.name}</strong>
                  <span style={{ color: "var(--ink-soft)", fontSize: ".8rem" }}>${a.priceUsd}</span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ───── SEO ───── */}
      {tab === "seo" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="search" size={18} />
            <h3>SEO</h3>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Meta Title
              <span className="pe-field-sub">
                Leave empty to use product name ({form.name || "Product Name"}).
              </span>
              <input
                className="input"
                value={form.metaTitle}
                onChange={(e) => set("metaTitle", e.target.value)}
                placeholder={form.name || "Product Name"}
              />
            </label>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Meta Description
              <span className="pe-field-sub">Leave empty to use the product description.</span>
              <textarea
                className="input"
                rows={3}
                value={form.metaDescription}
                onChange={(e) => set("metaDescription", e.target.value)}
                placeholder="A short description for search engines..."
              />
            </label>
          </div>
          <div className="pe-seo-preview">
            <span className="pe-seo-url">
              https://yourstore.com/products/{form.slug || "product-url"}
            </span>
            <span className="pe-seo-title">{form.metaTitle || form.name || "Product Name"}</span>
            <span className="pe-seo-desc">
              {form.metaDescription || "A short description for search engines..."}
            </span>
          </div>
        </section>
      )}

      {/* ───── Visibility ───── */}
      {tab === "visibility" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="shield" size={18} />
            <h3>Visibility</h3>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Product Status
              <Dropdown<string>
                value={form.active ? "active" : "hidden"}
                onChange={(v) => set("active", v === "active")}
                options={[
                  { value: "active", label: "Active — Visible to everyone" },
                  { value: "hidden", label: "Hidden — Not visible on store" },
                ]}
                width="100%"
              />
            </label>
          </div>
          <div className="pe-form-row">
            <label
              className="pe-field-label"
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <input
                type="checkbox"
                checked={form.showWhenOutOfStock}
                onChange={(e) => set("showWhenOutOfStock", e.target.checked)}
              />
              Show product when out of stock
            </label>
          </div>
          <div className="pe-form-row">
            <label
              className="pe-field-label"
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <input
                type="checkbox"
                checked={form.requireEmailVerification}
                onChange={(e) => set("requireEmailVerification", e.target.checked)}
              />
              Require email verification before purchase
            </label>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Limit Per Customer <em>(optional)</em>
              <span className="pe-field-sub">
                Max purchases of this product per customer. Leave empty for unlimited.
              </span>
              <NumberInput
                min={1}
                value={form.limitPerCustomer}
                onChange={(v) => set("limitPerCustomer", v)}
              />
            </label>
          </div>
        </section>
      )}

      {/* ───── Financials ───── */}
      {tab === "financials" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="activity" size={18} />
            <h3>Financials</h3>
          </div>
          <div className="kv-row" style={{ gap: 16, flexDirection: "column" }}>
            <div className="kv">
              <span className="kv-label">Total Revenue</span>
              <span
                className="kv-val"
                style={{ color: "var(--success)", fontSize: "1.4rem", fontWeight: 700 }}
              >
                ${product ? (product.sold * product.priceUsd).toFixed(2) : "0.00"}
              </span>
            </div>
            <div className="kv">
              <span className="kv-label">Units Sold</span>
              <span className="kv-val">{product?.sold ?? 0}</span>
            </div>
            <div className="kv">
              <span className="kv-label">Average Order Value</span>
              <span className="kv-val">${product ? product.priceUsd.toFixed(2) : "0.00"}</span>
            </div>
          </div>
          <div
            className="pe-form-row"
            style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 20 }}
          >
            <label className="pe-field-label">
              Payout Tax Override % <em>(optional)</em>
              <span className="pe-field-sub">
                Override the default payout tax percentage for this product only.
              </span>
              <NumberInput
                decimal
                min={0}
                max={100}
                value={form.payoutTaxPercent}
                onChange={(v) => set("payoutTaxPercent", v)}
              />
            </label>
          </div>
        </section>
      )}

      {/* ───── Statistics ───── */}
      {tab === "statistics" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="activity" size={18} />
            <h3>Statistics</h3>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))",
              gap: 16,
            }}
          >
            {[
              { label: "Total Sales", value: product?.sold ?? 0 },
              { label: "Available Stock", value: product?.available ?? 0 },
              { label: "Delivered", value: product?.delivered ?? 0 },
              {
                label: "Revenue (est.)",
                value: `$${((product?.sold ?? 0) * (product?.priceUsd ?? 0)).toFixed(2)}`,
              },
            ].map((s) => (
              <div key={s.label} className="pe-stat-card">
                <span className="pe-stat-label">{s.label}</span>
                <span className="pe-stat-value">{s.value}</span>
              </div>
            ))}
          </div>
          {!product && (
            <p className="pe-field-sub" style={{ marginTop: 12 }}>
              Statistics will appear here after the product is created and has sales.
            </p>
          )}
        </section>
      )}

      {/* ───── Discord ───── */}
      {tab === "discord" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="bell" size={18} />
            <h3>Discord Role Delivery</h3>
          </div>
          <p className="pe-field-sub">
            Automatically grant a Discord role to customers after purchase.
          </p>
          <div className="pe-form-row" style={{ marginTop: 16 }}>
            <label className="pe-field-label">
              Discord Server ID
              <span className="pe-field-sub">
                Right-click your server → Copy ID (enable Developer Mode first).
              </span>
              <input
                className="input"
                value={form.discordServerId}
                onChange={(e) => set("discordServerId", e.target.value)}
                placeholder="e.g. 1234567890"
              />
            </label>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Discord Role ID
              <span className="pe-field-sub">Right-click the role → Copy ID.</span>
              <input
                className="input"
                value={form.discordRoleId}
                onChange={(e) => set("discordRoleId", e.target.value)}
                placeholder="e.g. 9876543210"
              />
            </label>
          </div>
          <div className="pe-disc-info">
            <Icon name="bell" size={15} />
            <span>
              Make sure the Nexora bot is in your server and has <strong>Manage Roles</strong>{" "}
              permission.
            </span>
          </div>
        </section>
      )}

      {/* ───── Developer ───── */}
      {tab === "developer" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="zap" size={18} />
            <h3>Developer / Webhook</h3>
          </div>
          <p className="pe-field-sub">
            Configure a webhook URL to deliver dynamic product content. Only applies when
            deliverable type is <strong>Dynamic</strong>.
          </p>
          <div className="pe-form-row" style={{ marginTop: 16 }}>
            <label className="pe-field-label">
              Webhook URL
              <input
                className="input"
                value={form.webhookUrl}
                onChange={(e) => set("webhookUrl", e.target.value)}
                placeholder="https://your-api.com/webhook"
              />
            </label>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Product ID <em>(read-only)</em>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="input"
                  value={product?.id ?? "Will be assigned after creation"}
                  readOnly
                  style={{ color: "var(--ink-soft)" }}
                />
                {product?.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigator.clipboard.writeText(product.id)}
                  >
                    <Icon name="copy" size={13} /> Copy
                  </button>
                )}
              </div>
            </label>
          </div>
        </section>
      )}

      {/* ───── Miscellaneous ───── */}
      {tab === "miscellaneous" && (
        <section className="pe-pane card">
          <div className="pe-pane-header">
            <Icon name="settings" size={18} />
            <h3>Miscellaneous</h3>
          </div>
          <div className="pe-form-row">
            <label
              className="pe-field-label"
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => set("featured", e.target.checked)}
              />
              Featured product (highlighted on storefront)
            </label>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Sort Order <em>(optional)</em>
              <span className="pe-field-sub">
                Lower numbers appear first. Leave empty for default ordering.
              </span>
              <NumberInput min={0} value={form.sortOrder} onChange={(v) => set("sortOrder", v)} />
            </label>
          </div>
          <div className="grid-2" style={{ marginTop: 0 }}>
            <label className="pe-field-label">
              Min Order Quantity
              <NumberInput
                min={1}
                value={form.minOrderQty}
                onChange={(v) => set("minOrderQty", v)}
              />
            </label>
            <label className="pe-field-label">
              Max Order Quantity <em>(optional)</em>
              <NumberInput
                min={1}
                value={form.maxOrderQty}
                onChange={(v) => set("maxOrderQty", v)}
              />
            </label>
          </div>
          <div className="pe-form-row">
            <label className="pe-field-label">
              Warranty <em>(days, optional)</em>
              <span className="pe-field-sub">Shown on the product page and invoice.</span>
              <NumberInput
                min={1}
                value={form.warrantyDays}
                onChange={(v) => set("warrantyDays", v)}
              />
            </label>
          </div>
        </section>
      )}

      <style>{`
        .pe { display: flex; flex-direction: column; gap: 20px; }
        .pe-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 4px; }
        .pe-head h1 { font-size: 1.8rem; font-weight: 700; color: var(--ink); }
        .pe-head .muted { font-size: .9rem; color: var(--ink-soft); margin-top: 4px; }
        .pe-actions { display: flex; gap: 8px; }
        .pe-btn-cancel { border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink-soft); }
        .pe-btn-save { border: 1px solid var(--line-strong); color: var(--ink); font-weight: 600; }
        .pe-btn-create { background: var(--brand); color: #fff; font-weight: 600; }
        
        .pe-alert-banner { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-radius: var(--radius); background: rgba(79,70,229,0.06); border: 1px solid rgba(79,70,229,0.18); color: var(--ink); font-size: 0.88rem; }
        .pe-alert-banner svg { color: var(--brand); }
        .pe-alert-banner a { color: var(--brand); font-weight: 600; text-decoration: none; }
        .pe-alert-banner a:hover { text-decoration: underline; }

        .pe-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 2px; overflow-x: auto; scrollbar-width: none; }
        .pe-tabs::-webkit-scrollbar { display: none; }
        .pe-tab { display: inline-flex; align-items: center; gap: 8px; background: none; border: none; color: var(--ink-soft); font-family: var(--font-sans); font-weight: 600; font-size: .88rem; padding: 10px 16px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s, border-color .15s; white-space: nowrap; }
        .pe-tab:hover { color: var(--ink); }
        .pe-tab.on { color: var(--brand); border-bottom-color: var(--brand); }

        .pe-pane { padding: 28px 32px; display: flex; flex-direction: column; gap: 24px; }
        .pe-pane-header { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 4px; }
        .pe-pane-header svg { color: var(--ink-soft); }
        .pe-pane-header h3 { font-size: 1.15rem; font-weight: 700; color: var(--ink); margin: 0; }
        
        .pe-form-row { display: flex; flex-direction: column; gap: 6px; }
        .pe-field-label { display: flex; flex-direction: column; gap: 6px; font-size: .88rem; font-weight: 600; color: var(--ink); }
        .pe-field-label em { font-weight: 400; color: var(--ink-faint); font-style: normal; }
        .pe-field-sub { font-size: .82rem; color: var(--ink-soft); margin-top: -2px; font-weight: 400; }
        
        .rt-container { border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; background: var(--surface-2); display: flex; flex-direction: column; }
        .rt-container textarea { border: none; border-top: 1px solid var(--line-strong); padding: 12px 14px; font-family: var(--font-sans); font-size: .92rem; color: var(--ink); background: var(--surface); outline: none; resize: vertical; }
        
        .rt-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-2); flex-wrap: wrap; }
        .rt-group { display: flex; align-items: center; gap: 4px; }
        .rt-btn { background: none; border: none; color: var(--ink-soft); padding: 6px 10px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-family: var(--font-sans); transition: background .12s, color .12s; }
        .rt-btn:hover { background: var(--line-strong); color: var(--ink); }
        .rt-divider { width: 1px; height: 18px; background: var(--line-strong); margin: 0 4px; }
        .rt-select { background: var(--surface); border: 1px solid var(--line-strong); border-radius: 4px; padding: 4px 8px; font-size: 0.82rem; color: var(--ink-soft); outline: none; }
        .rotate-180 { transform: rotate(180deg); }

        .gallery-picker-wrapper { display: flex; flex-direction: column; gap: 10px; }
        .gallery-picker { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px 20px; border: 2px dashed var(--line-strong); border-radius: var(--radius); cursor: pointer; color: var(--ink-soft); font-size: 0.88rem; transition: background .15s, border-color .15s; background: var(--surface-2); text-align: center; }
        .gallery-picker:hover { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
        .gallery-preview { max-width: 100%; max-height: 240px; object-fit: contain; border-radius: var(--radius-sm); }

        .pe-deliverables-section { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 24px; margin-top: 8px; }
        .pe-deliverables-section h4 { font-size: 1.05rem; font-weight: 700; color: var(--ink); }
        .pe-deliv-options { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
        
        .pe-deliv-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 24px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); cursor: pointer; transition: all .18s var(--ease); relative; }
        .pe-deliv-card:hover { border-color: var(--brand); background: var(--surface-2); }
        .pe-deliv-card.on { border-color: var(--brand); background: var(--brand-soft); }
        .pe-deliv-card input { position: absolute; opacity: 0; pointer-events: none; }
        
        .pe-radio-selector { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-strong); flex-shrink: 0; transition: all .15s; }
        .pe-radio-selector.on { border-color: var(--brand); background: radial-gradient(circle at center, var(--brand) 0 5px, transparent 6px); }
        
        .pe-deliv-card-content { flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .pe-deliv-card-content strong { font-size: 0.95rem; font-weight: 600; color: var(--ink); }
        .pe-deliv-card-content span { font-size: 0.82rem; color: var(--ink-soft); line-height: 1.4; }

        .pe-variant-card-container { border: 1.5px solid var(--line-strong); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
        .pe-variant-header-row { padding: 12px 20px; background: var(--surface-2); border-bottom: 1px solid var(--line-strong); }
        .pe-variant-title { font-weight: 700; font-size: 0.9rem; color: var(--ink); }

        .pe-variants-section { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 24px; margin-top: 12px; }
        .pe-variants-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .pe-variants-header h4 { font-size: 1.05rem; font-weight: 700; color: var(--ink); }

        .pe-variant-editor-row { display: grid; grid-template-columns: 1.5fr 1fr 1fr auto; gap: 12px; align-items: flex-end; padding: 16px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface-2); }
        .btn-danger-icon { padding: 10px; color: var(--price); border: 1px solid var(--line-strong); background: var(--surface); }
        .btn-danger-icon:hover { background: var(--price-soft); }

        .tab-placeholder-pane { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 80px 40px; gap: 16px; }
        .placeholder-icon { color: var(--ink-faint); margin-bottom: 8px; }
        .placeholder-form { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 380px; margin-top: 12px; }

        @media (max-width: 860px) {
          .pe-variant-editor-row { grid-template-columns: 1fr; }
          .pe-head { flex-direction: column; align-items: flex-start; }
          .pe-actions { width: 100%; justify-content: space-between; }
        }

        /* Custom Fields */
        .pe-cf-row { display: grid; grid-template-columns: 1fr 130px auto auto; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface-2); }

        /* Addons Grid */
        .pe-addon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: 10px; margin-top: 16px; }
        .pe-addon-card { position: relative; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding: 12px 14px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; background: var(--surface-2); transition: all .15s; }
        .pe-addon-card:hover { border-color: var(--brand); }
        .pe-addon-card.on { border-color: var(--brand); background: var(--brand-soft); }
        .pe-addon-check { width: 18px; height: 18px; border-radius: 4px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }

        /* SEO Preview */
        .pe-seo-preview { display: flex; flex-direction: column; gap: 4px; padding: 16px; background: var(--surface-2); border: 1px solid var(--line-strong); border-radius: var(--radius); margin-top: 16px; }
        .pe-seo-url { font-size: .78rem; color: var(--success); }
        .pe-seo-title { font-size: 1.05rem; color: #1a0dab; font-weight: 600; }
        [data-theme="dark"] .pe-seo-title { color: #8ab4f8; }
        .pe-seo-desc { font-size: .82rem; color: var(--ink-soft); line-height: 1.5; }

        /* Statistics */
        .pe-stat-card { padding: 16px 20px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface-2); display: flex; flex-direction: column; gap: 4px; }
        .pe-stat-label { font-size: .78rem; font-weight: 600; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .06em; }
        .pe-stat-value { font-size: 1.6rem; font-weight: 700; color: var(--ink); }

        /* Discord info */
        .pe-disc-info { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; background: rgba(88,101,242,.08); border: 1px solid rgba(88,101,242,.2); border-radius: var(--radius-sm); font-size: .85rem; color: var(--ink); margin-top: 8px; }

        /* KV rows */
        .kv-row { display: flex; flex-wrap: wrap; gap: 16px; }
        .kv { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 120px; }
        .kv-label { font-size: .78rem; font-weight: 600; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .06em; }
        .kv-val { font-size: 1.2rem; font-weight: 700; color: var(--ink); }
      `}</style>
    </div>
  );
};
