import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Dropdown } from "../Dropdown";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";

interface QuantityDeal {
  id: string;
  name: string;
  productId: string;
  productName?: string;
  variantId?: string;
  buyQty: number;
  discountedQty: number;
  discountPercent: number;
  status: "enabled" | "disabled";
  startDate?: string;
  endDate?: string;
  maxUsesPerCart?: number;
  priority?: number;
}

interface Product {
  id: string;
  name: string;
}

const EMPTY: Omit<QuantityDeal, "id" | "productName"> = {
  name: "",
  productId: "",
  variantId: "",
  buyQty: 2,
  discountedQty: 1,
  discountPercent: 50,
  status: "enabled",
  startDate: "",
  endDate: "",
  maxUsesPerCart: undefined,
  priority: undefined,
};

export const AdminQuantityDeals: React.FC = () => {
  const [deals, setDeals] = useState<QuantityDeal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<QuantityDeal | null>(null);
  const [form, setForm] = useState<Omit<QuantityDeal, "id" | "productName">>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<QuantityDeal[]>("/api/admin/quantity-deals").catch(() => [] as QuantityDeal[]),
      api.get<Product[]>("/api/admin/products").catch(() => [] as Product[]),
    ])
      .then(([d, p]) => {
        setDeals(d);
        setProducts(p);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm(EMPTY);
    setEditing(null);
    setCreating(true);
    setErr(null);
  };
  const openEdit = (d: QuantityDeal) => {
    setForm({
      name: d.name,
      productId: d.productId,
      variantId: d.variantId ?? "",
      buyQty: d.buyQty,
      discountedQty: d.discountedQty,
      discountPercent: d.discountPercent,
      status: d.status,
      startDate: d.startDate ?? "",
      endDate: d.endDate ?? "",
      maxUsesPerCart: d.maxUsesPerCart,
      priority: d.priority,
    });
    setEditing(d);
    setCreating(true);
    setErr(null);
  };
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    if (!form.name.trim()) return setErr("Name is required");
    if (!form.productId) return setErr("Product is required");
    setBusy(true);
    setErr(null);
    try {
      if (editing) await api.patch(`/api/admin/quantity-deals/${editing.id}`, form);
      else await api.post("/api/admin/quantity-deals", form);
      closeForm();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this quantity deal?")) return;
    await api.del(`/api/admin/quantity-deals/${id}`).catch(() => {});
    load();
  };

  if (creating)
    return (
      <div className="adm-section">
        <div className="adm-sec-head">
          <div>
            <h2>{editing ? "Edit Quantity Deal" : "Create Quantity Deal"}</h2>
            <p className="muted">
              Fill in the details below to {editing ? "edit this" : "create a new"} quantity deal.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={closeForm}>
              <Icon name="close" size={14} /> Cancel
            </button>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? (
                <>
                  <Icon name="spinner" size={14} className="is-spinning" /> Saving…
                </>
              ) : (
                <>
                  <Icon name="check" size={14} /> {editing ? "Save" : "Create"}
                </>
              )}
            </button>
          </div>
        </div>

        {err && <div className="pe-err">{err}</div>}

        <div
          className="card"
          style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}
        >
          <div className="adm-section-label">General</div>

          <label className="pe-field-label">
            Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Deal name"
            />
          </label>

          <label className="pe-field-label">
            Product
            <Dropdown<string>
              value={form.productId}
              onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
              options={[
                { value: "", label: "Select product…" },
                ...products.map((p) => ({ value: p.id, label: p.name })),
              ]}
              width="100%"
            />
          </label>

          <div className="grid-3">
            <label className="pe-field-label">
              Buy Quantity
              <span className="pe-field-sub">Customer must add at least this many items.</span>
              <NumberInput
                min={1}
                value={String(form.buyQty)}
                onChange={(v) => setForm((f) => ({ ...f, buyQty: Number(v) || 1 }))}
              />
            </label>
            <label className="pe-field-label">
              Discounted Quantity
              <span className="pe-field-sub">Number of items that receive the discount.</span>
              <NumberInput
                min={1}
                value={String(form.discountedQty)}
                onChange={(v) => setForm((f) => ({ ...f, discountedQty: Number(v) || 1 }))}
              />
            </label>
            <label className="pe-field-label">
              Discount %<span className="pe-field-sub">100% = free.</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <NumberInput
                  min={1}
                  max={100}
                  value={String(form.discountPercent)}
                  onChange={(v) => setForm((f) => ({ ...f, discountPercent: Number(v) || 50 }))}
                />
                <div className="qd-quick-btns">
                  {[25, 50, 75, 100].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setForm((f) => ({ ...f, discountPercent: n }))}
                    >
                      {n}%
                    </button>
                  ))}
                </div>
              </div>
            </label>
          </div>

          <label className="pe-field-label">
            Status
            <select
              className="input"
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as "enabled" | "disabled" }))
              }
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>

          <div className="adm-section-label" style={{ marginTop: 8 }}>
            Schedule &amp; Limits
          </div>

          <div className="grid-2">
            <label className="pe-field-label">
              Start Date <em>(optional)</em>
              <input
                className="input"
                type="datetime-local"
                value={form.startDate ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </label>
            <label className="pe-field-label">
              End Date <em>(optional)</em>
              <input
                className="input"
                type="datetime-local"
                value={form.endDate ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </label>
          </div>

          <div className="grid-2">
            <label className="pe-field-label">
              Max Uses Per Cart <em>(optional)</em>
              <span className="pe-field-sub">Leave empty for unlimited.</span>
              <NumberInput
                min={1}
                value={String(form.maxUsesPerCart ?? "")}
                onChange={(v) =>
                  setForm((f) => ({ ...f, maxUsesPerCart: v ? Number(v) : undefined }))
                }
              />
            </label>
            <label className="pe-field-label">
              Priority <em>(optional)</em>
              <span className="pe-field-sub">Higher priority deals are applied first.</span>
              <NumberInput
                min={0}
                value={String(form.priority ?? "")}
                onChange={(v) => setForm((f) => ({ ...f, priority: v ? Number(v) : undefined }))}
              />
            </label>
          </div>
        </div>
        <style>{`.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; } .qd-quick-btns { display: flex; gap: 4px; } @media (max-width: 720px) { .grid-3 { grid-template-columns: 1fr; } }`}</style>
      </div>
    );

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Quantity Deals</h2>
          <p className="muted">Automatically apply discounts when customers buy in bulk.</p>
        </div>
        <button className="btn" onClick={openCreate}>
          <Icon name="plus" size={14} /> Create Quantity Deal
        </button>
      </div>

      <div className="adm-info-card card">
        <div className="adm-info-icon">
          <Icon name="tag" size={20} />
        </div>
        <div>
          <strong>Buy X Get Y% Off</strong>
          <p className="muted" style={{ fontSize: ".84rem", marginTop: 4 }}>
            Quantity Deals automatically apply a discount when a customer buys a certain number of
            items. No coupon code required.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={24} className="is-spinning" />
        </div>
      ) : deals.length === 0 ? (
        <EmptyState
          icon="tag"
          title="No Quantity Deals"
          message="Create quantity deals to automatically reward bulk buyers."
          action={{ label: "Create Quantity Deal", onClick: openCreate }}
        />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Product</th>
                <th>Deal</th>
                <th>Discount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                  </td>
                  <td>{d.productName ?? d.productId}</td>
                  <td>
                    Buy {d.buyQty}, get {d.discountedQty} at discount
                  </td>
                  <td>{d.discountPercent}%</td>
                  <td>
                    <span
                      className={`badge ${d.status === "enabled" ? "badge-green" : "badge-gray"}`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(d)}>
                        <Icon name="settings" size={13} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm btn-danger-icon"
                        onClick={() => remove(d.id)}
                      >
                        <Icon name="close" size={13} />
                      </button>
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
