import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { RichTextEditor } from "../RichTextEditor";

interface Group {
  id: string;
  name: string;
  description: string;
  image: string;
  active: boolean;
  productIds: string[];
  badge?: string;
  badgeColor?: string;
}

interface Product { id: string; name: string; image: string; priceUsd: number; }

const EMPTY: Omit<Group, "id"> = {
  name: "", description: "", image: "", active: true, productIds: [], badge: "", badgeColor: "",
};

export const AdminGroups: React.FC = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<Group, "id">>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<Group[]>("/api/admin/groups").catch(() => [] as Group[]),
      api.get<Product[]>("/api/admin/products").catch(() => [] as Product[]),
    ]).then(([g, p]) => { setGroups(g); setProducts(p); }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(EMPTY); setEditing(null); setCreating(true); setErr(null); };
  const openEdit = (g: Group) => { setForm({ name: g.name, description: g.description, image: g.image, active: g.active, productIds: g.productIds, badge: g.badge ?? "", badgeColor: g.badgeColor ?? "" }); setEditing(g); setCreating(true); setErr(null); };
  const closeForm = () => { setCreating(false); setEditing(null); };

  const save = async () => {
    if (!form.name.trim()) return setErr("Name is required");
    setBusy(true); setErr(null);
    try {
      if (editing) await api.patch(`/api/admin/groups/${editing.id}`, form);
      else await api.post("/api/admin/groups", form);
      closeForm(); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this group?")) return;
    await api.delete(`/api/admin/groups/${id}`).catch(() => {});
    load();
  };

  const toggleProduct = (id: string) => {
    setForm(f => ({
      ...f,
      productIds: f.productIds.includes(id) ? f.productIds.filter(p => p !== id) : [...f.productIds, id],
    }));
  };

  if (creating) return (
    <div className="grp-editor">
      <div className="grp-head">
        <div>
          <h2>{editing ? "Edit Group" : "Create Group"}</h2>
          <p className="muted">Create a new group to organize your products.</p>
        </div>
        <div className="grp-actions">
          <button className="btn btn-ghost" onClick={closeForm} type="button"><Icon name="close" size={14} /> Cancel</button>
          <button className="btn" onClick={save} disabled={busy} type="button">
            {busy ? <><Icon name="spinner" size={14} className="is-spinning" /> Saving…</> : <><Icon name="check" size={14} /> {editing ? "Save" : "Create"}</>}
          </button>
        </div>
      </div>

      {err && <div className="pe-err">{err}</div>}

      <div className="grp-form card">
        <div className="grp-section-title"><Icon name="folder" size={16} /> General</div>

        <label className="pe-field-label">Name<input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Group name" /></label>
        <label className="pe-field-label">Image URL
          <div className="gallery-picker" onClick={() => { const u = prompt("Image URL:"); if (u) setForm(f => ({ ...f, image: u })); }}>
            {form.image ? <img src={form.image} alt="" style={{ maxHeight: 120, borderRadius: 8 }} /> : <><Icon name="package" size={28} /><span>Tap to select image</span></>}
          </div>
        </label>
        <label className="pe-field-label">Visibility
          <select className="input" value={form.active ? "public" : "hidden"} onChange={e => setForm(f => ({ ...f, active: e.target.value === "public" }))}>
            <option value="public">Public</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>

        <div className="grp-section-title" style={{ marginTop: 8 }}><Icon name="tag" size={16} /> Badge <span className="badge-opt">(optional)</span></div>
        <div className="grid-2">
          <label className="pe-field-label">Badge Text<input className="input" value={form.badge ?? ""} onChange={e => setForm(f => ({ ...f, badge: e.target.value }))} placeholder="e.g. NEW, HOT" /></label>
          <label className="pe-field-label">Badge Color<input className="input" type="color" value={form.badgeColor || "#4f46e5"} onChange={e => setForm(f => ({ ...f, badgeColor: e.target.value }))} /></label>
        </div>

        <div className="grp-section-title" style={{ marginTop: 8 }}><Icon name="box" size={16} /> Products</div>
        <p className="pe-field-sub">Select which products to include in this group.</p>
        <div className="grp-products-grid">
          {products.map(p => (
            <label key={p.id} className={`grp-product-card ${form.productIds.includes(p.id) ? "on" : ""}`}>
              <input type="checkbox" checked={form.productIds.includes(p.id)} onChange={() => toggleProduct(p.id)} style={{ display: "none" }} />
              {p.image && <img src={p.image} alt={p.name} className="grp-product-img" />}
              <span>{p.name}</span>
              <span className="grp-product-price">${p.priceUsd}</span>
              {form.productIds.includes(p.id) && <span className="grp-product-check"><Icon name="check" size={12} /></span>}
            </label>
          ))}
        </div>
      </div>

      <style>{`
        .grp-editor { display: flex; flex-direction: column; gap: 20px; }
        .grp-head { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
        .grp-head h2 { font-size: 1.5rem; font-weight: 700; }
        .grp-actions { display: flex; gap: 8px; }
        .grp-form { display: flex; flex-direction: column; gap: 16px; padding: 24px; }
        .grp-section-title { display: flex; align-items: center; gap: 8px; font-size: .88rem; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
        .badge-opt { font-weight: 400; text-transform: none; color: var(--ink-faint); letter-spacing: 0; }
        .grp-products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px,1fr)); gap: 10px; }
        .grp-product-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; text-align: center; font-size: .82rem; font-weight: 500; color: var(--ink); transition: all .15s; background: var(--surface-2); }
        .grp-product-card:hover { border-color: var(--brand); }
        .grp-product-card.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
        .grp-product-img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; }
        .grp-product-price { color: var(--ink-faint); font-size: .78rem; }
        .grp-product-check { position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; }
      `}</style>
    </div>
  );

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Groups</h2>
          <p className="muted">Manage your product groups.</p>
        </div>
        <button className="btn" onClick={openCreate}><Icon name="plus" size={14} /> Create Group</button>
      </div>

      {loading ? <div className="adm-loading"><Icon name="spinner" size={24} className="is-spinning" /></div>
        : groups.length === 0 ? (
          <EmptyState icon="folder" title="No Groups Yet" message="Create a group to bundle products under one card." action={{ label: "Create Group", onClick: openCreate }} />
        ) : (
          <div className="grp-list">
            {groups.map(g => (
              <div key={g.id} className="grp-row card">
                {g.image && <img src={g.image} alt={g.name} className="grp-row-img" />}
                <div className="grp-row-info">
                  <strong>{g.name}</strong>
                  {g.badge && <span className="grp-badge" style={{ background: g.badgeColor || "var(--brand)" }}>{g.badge}</span>}
                  <span className="muted" style={{ fontSize: ".82rem" }}>{g.productIds.length} products · {g.active ? "Public" : "Hidden"}</span>
                </div>
                <div className="grp-row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(g)}><Icon name="settings" size={14} /> Edit</button>
                  <button className="btn btn-ghost btn-sm btn-danger-icon" onClick={() => remove(g.id)}><Icon name="close" size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

      <style>{`
        .grp-list { display: flex; flex-direction: column; gap: 10px; }
        .grp-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
        .grp-row-img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
        .grp-row-info { flex: 1; display: flex; flex-direction: column; gap: 3px; }
        .grp-row-actions { display: flex; gap: 6px; }
        .grp-badge { font-size: .68rem; font-weight: 700; padding: 2px 7px; border-radius: 20px; color: #fff; width: fit-content; }
      `}</style>
    </div>
  );
};
