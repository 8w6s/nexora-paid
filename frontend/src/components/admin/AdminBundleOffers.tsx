import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { Dropdown } from "../Dropdown";

interface BundleProduct { productId: string; productName?: string; variantId?: string; qty: number; }
interface BundleOffer {
  id: string;
  name: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  status: "enabled" | "disabled";
  products: BundleProduct[];
  startDate?: string;
  endDate?: string;
  maxUsesPerCart?: number;
  priority?: number;
}

interface Product { id: string; name: string; }

const EMPTY: Omit<BundleOffer, "id"> = {
  name: "", discountType: "percentage", discountValue: 15, status: "enabled",
  products: [], startDate: "", endDate: "", maxUsesPerCart: undefined, priority: undefined,
};

export const AdminBundleOffers: React.FC = () => {
  const [offers, setOffers] = useState<BundleOffer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BundleOffer | null>(null);
  const [form, setForm] = useState<Omit<BundleOffer, "id">>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<BundleOffer[]>("/api/admin/bundle-offers").catch(() => [] as BundleOffer[]),
      api.get<Product[]>("/api/admin/products").catch(() => [] as Product[]),
    ]).then(([o, p]) => { setOffers(o); setProducts(p); }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(EMPTY); setEditing(null); setCreating(true); setErr(null); };
  const openEdit = (o: BundleOffer) => { setForm({ name: o.name, discountType: o.discountType, discountValue: o.discountValue, status: o.status, products: o.products, startDate: o.startDate ?? "", endDate: o.endDate ?? "", maxUsesPerCart: o.maxUsesPerCart, priority: o.priority }); setEditing(o); setCreating(true); setErr(null); };
  const closeForm = () => { setCreating(false); setEditing(null); };

  const save = async () => {
    if (!form.name.trim()) return setErr("Name is required");
    if (form.products.length === 0) return setErr("Add at least one product to the bundle");
    setBusy(true); setErr(null);
    try {
      if (editing) await api.patch(`/api/admin/bundle-offers/${editing.id}`, form);
      else await api.post("/api/admin/bundle-offers", form);
      closeForm(); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this bundle offer?")) return;
    await api.delete(`/api/admin/bundle-offers/${id}`).catch(() => {});
    load();
  };

  const addBundleProduct = (productId: string) => {
    if (!productId || form.products.some(p => p.productId === productId)) return;
    const product = products.find(p => p.id === productId);
    setForm(f => ({ ...f, products: [...f.products, { productId, productName: product?.name, qty: 1 }] }));
  };

  const removeBundleProduct = (idx: number) => setForm(f => ({ ...f, products: f.products.filter((_, i) => i !== idx) }));
  const updateQty = (idx: number, qty: number) => setForm(f => ({ ...f, products: f.products.map((p, i) => i === idx ? { ...p, qty } : p) }));

  if (creating) return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>{editing ? "Edit Bundle Offer" : "Create Bundle Offer"}</h2>
          <p className="muted">Fill in the details below to {editing ? "edit this" : "create a new"} bundle offer.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={closeForm}><Icon name="close" size={14} /> Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? <><Icon name="spinner" size={14} className="is-spinning" /> Saving…</> : <><Icon name="check" size={14} /> {editing ? "Save" : "Create"}</>}
          </button>
        </div>
      </div>

      {err && <div className="pe-err">{err}</div>}

      <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="adm-section-label">General</div>

        <label className="pe-field-label">Name
          <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Bundle name" />
        </label>

        <div className="grid-2">
          <label className="pe-field-label">Discount Type
            <select className="input" value={form.discountType} onChange={e => setForm(f => ({ ...f, discountType: e.target.value as "percentage" | "fixed" }))}>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed Amount</option>
            </select>
          </label>
          <label className="pe-field-label">Discount {form.discountType === "percentage" ? "%" : "Amount"}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <NumberInput min={0} max={form.discountType === "percentage" ? 100 : undefined} decimal={form.discountType === "fixed"} value={String(form.discountValue)} onChange={v => setForm(f => ({ ...f, discountValue: Number(v) || 0 }))} />
              {form.discountType === "percentage" && (
                <div style={{ display: "flex", gap: 4 }}>
                  {[5, 10, 15, 25, 50].map(n => <button key={n} type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, discountValue: n }))}>{n}%</button>)}
                </div>
              )}
            </div>
          </label>
        </div>

        <label className="pe-field-label">Status
          <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as "enabled" | "disabled" }))}>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>

        <div className="adm-section-label" style={{ marginTop: 8 }}>Bundle Products</div>
        <p className="pe-field-sub">Add the products that must be in the cart to trigger this bundle. Set required quantity for each.</p>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <Dropdown<string>
              value=""
              onChange={addBundleProduct}
              options={[
                { value: "", label: "Add Product…" },
                ...products.filter(p => !form.products.some(fp => fp.productId === p.id)).map(p => ({ value: p.id, label: p.name })),
              ]}
              width="100%"
            />
          </div>
        </div>

        {form.products.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {form.products.map((p, i) => (
              <div key={p.productId} className="bundle-product-row">
                <Icon name="box" size={16} />
                <span style={{ flex: 1 }}>{p.productName ?? p.productId}</span>
                <label className="pe-field-label" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <span>Qty:</span>
                  <NumberInput min={1} value={String(p.qty)} onChange={v => updateQty(i, Number(v) || 1)} />
                </label>
                <button type="button" className="btn btn-ghost btn-sm btn-danger-icon" onClick={() => removeBundleProduct(i)}><Icon name="close" size={13} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="adm-section-label" style={{ marginTop: 8 }}>Schedule &amp; Limits</div>
        <div className="grid-2">
          <label className="pe-field-label">Start Date <em>(optional)</em>
            <input className="input" type="datetime-local" value={form.startDate ?? ""} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
          </label>
          <label className="pe-field-label">End Date <em>(optional)</em>
            <input className="input" type="datetime-local" value={form.endDate ?? ""} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
          </label>
          <label className="pe-field-label">Max Uses Per Cart <em>(optional)</em>
            <NumberInput min={1} value={String(form.maxUsesPerCart ?? "")} onChange={v => setForm(f => ({ ...f, maxUsesPerCart: v ? Number(v) : undefined }))} />
          </label>
          <label className="pe-field-label">Priority <em>(optional)</em>
            <NumberInput min={0} value={String(form.priority ?? "")} onChange={v => setForm(f => ({ ...f, priority: v ? Number(v) : undefined }))} />
          </label>
        </div>
      </div>
      <style>{`.bundle-product-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--surface-2); }`}</style>
    </div>
  );

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Bundle Offers</h2>
          <p className="muted">Browse and manage your bundle offers.</p>
        </div>
        <button className="btn" onClick={openCreate}><Icon name="plus" size={14} /> Create Bundle Offer</button>
      </div>

      <div className="adm-info-card card">
        <div className="adm-info-icon"><Icon name="box" size={20} /></div>
        <div>
          <strong>Sell more by bundling products together</strong>
          <p className="muted" style={{ fontSize: ".84rem", marginTop: 4 }}>Bundle Offers automatically apply a discount when a customer's cart contains a specific combination of products and quantities. No coupon code required.</p>
        </div>
      </div>

      {loading ? <div className="adm-loading"><Icon name="spinner" size={24} className="is-spinning" /></div>
        : offers.length === 0
          ? <EmptyState icon="box" title="No Bundle Offers" message="Create bundle offers to automatically discount product combinations." action={{ label: "Create Bundle Offer", onClick: openCreate }} />
          : (
            <div className="card" style={{ overflow: "hidden" }}>
              <table className="adm-table">
                <thead><tr><th>Name</th><th>Discount</th><th>Products</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {offers.map(o => (
                    <tr key={o.id}>
                      <td><strong>{o.name}</strong></td>
                      <td>{o.discountValue}{o.discountType === "percentage" ? "%" : "$"} off</td>
                      <td>{o.products.length} products</td>
                      <td><span className={`badge ${o.status === "enabled" ? "badge-green" : "badge-gray"}`}>{o.status}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(o)}><Icon name="settings" size={13} /></button>
                          <button className="btn btn-ghost btn-sm btn-danger-icon" onClick={() => remove(o.id)}><Icon name="close" size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
};
