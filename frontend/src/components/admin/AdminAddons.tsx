import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ConfirmModal } from "../ConfirmModal";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { useToast } from "../Toast";
import { ImagePicker } from "./ImagePicker";

interface Addon {
  id: string;
  name: string;
  description: string;
  image: string;
  priceUsd: number;
  currency: string;
  mandatory: boolean;
}

const EMPTY: Omit<Addon, "id"> = {
  name: "",
  description: "",
  image: "",
  priceUsd: 0,
  currency: "USD",
  mandatory: false,
};

export const AdminAddons: React.FC = () => {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Addon | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<Addon, "id">>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingAddon, setDeletingAddon] = useState<Addon | null>(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    api
      .get<Addon[]>("/api/admin/addons")
      .then(setAddons)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load addons"))
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
  const openEdit = (a: Addon) => {
    setForm({
      name: a.name,
      description: a.description,
      image: a.image,
      priceUsd: a.priceUsd,
      currency: a.currency,
      mandatory: a.mandatory,
    });
    setEditing(a);
    setCreating(true);
    setErr(null);
  };
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    if (!form.name.trim()) return setErr("Name is required");
    setBusy(true);
    setErr(null);
    try {
      if (editing) await api.patch(`/api/admin/addons/${editing.id}`, form);
      else await api.post("/api/admin/addons", form);
      closeForm();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = (a: Addon) => {
    setDeletingAddon(a);
  };
  const confirmRemove = async () => {
    if (!deletingAddon) return;
    try {
      await api.del(`/api/admin/addons/${deletingAddon.id}`);
      toast.success("Addon deleted.");
      setDeletingAddon(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (creating)
    return (
      <div className="adm-section">
        <div className="adm-sec-head">
          <div>
            <h2>{editing ? "Edit Addon" : "Create Addon"}</h2>
            <p className="muted">
              Fill in the details below to {editing ? "edit this" : "create a new"} addon.
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
              placeholder="Addon name"
            />
          </label>

          <div className="grid-2">
            <label className="pe-field-label">
              Price
              <NumberInput
                decimal
                min={0}
                value={String(form.priceUsd)}
                onChange={(v) => setForm((f) => ({ ...f, priceUsd: Number(v) || 0 }))}
              />
            </label>
            <label className="pe-field-label">
              Currency
              <select
                className="input"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              >
                {["USD", "EUR", "GBP", "JPY", "VND"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="pe-field-label">
            <span>
              Mandatory <em>(optional)</em>
            </span>
            <span className="pe-field-sub">
              If enabled, this addon will be automatically added and can't be removed by customers.
            </span>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={form.mandatory}
                onChange={(e) => setForm((f) => ({ ...f, mandatory: e.target.checked }))}
              />
              <span>This addon is mandatory</span>
            </label>
          </label>

          <div className="adm-section-label" style={{ marginTop: 8 }}>
            Details
          </div>

          <label className="pe-field-label">
            Description
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe this addon..."
            />
          </label>

          <label className="pe-field-label">
            Image
            <ImagePicker value={form.image} onChange={(u) => setForm((f) => ({ ...f, image: u }))} />
          </label>

          <p
            className="pe-field-sub"
            style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}
          >
            <Icon name="bell" size={14} /> To show addons on a product page, edit the product and
            select the wanted addons.
          </p>
        </div>

        <style>{`.toggle-row { display: flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer; }`}</style>
      </div>
    );

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Addons</h2>
          <p className="muted">Manage your product addons.</p>
        </div>
        <button className="btn" onClick={openCreate}>
          <Icon name="plus" size={14} /> Create Addon
        </button>
      </div>

      <div className="adm-info-card card">
        <div className="adm-info-icon">
          <Icon name="tag" size={20} />
        </div>
        <div>
          <strong>Boost your products with Addons</strong>
          <p className="muted" style={{ fontSize: ".84rem", marginTop: 4 }}>
            Addons are extra items shown as suggestions on individual product pages. Think warranty
            extensions, priority support, or upgrades. They don't appear in your main storefront.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={24} className="is-spinning" />
        </div>
      ) : addons.length === 0 ? (
        <EmptyState
          icon="tag"
          title="No Addons Yet"
          message="Create your first addon to offer extras alongside your products."
          action={{ label: "Create Addon", onClick: openCreate }}
        />
      ) : (
        <div className="addon-list">
          {addons.map((a) => (
            <div key={a.id} className="addon-row card">
              {a.image && <img src={a.image} alt={a.name} className="addon-img" />}
              <div style={{ flex: 1 }}>
                <strong>{a.name}</strong>
                {a.mandatory && <span className="addon-mandatory-badge">Mandatory</span>}
                <div className="muted" style={{ fontSize: ".82rem" }}>
                  ${a.priceUsd} {a.currency}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(a)}>
                  <Icon name="settings" size={14} /> Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger-icon"
                  onClick={() => remove(a)}
                  aria-label="Delete addon"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!deletingAddon}
        onClose={() => setDeletingAddon(null)}
        onConfirm={confirmRemove}
        title="Delete Addon"
        message={`Are you sure you want to delete "${deletingAddon?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />

      <style>{`
        .adm-info-card { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px; background: var(--brand-soft); border-color: rgba(79,70,229,.2); }
        .adm-info-icon { width: 36px; height: 36px; border-radius: 8px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .addon-list { display: flex; flex-direction: column; gap: 10px; }
        .addon-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
        .addon-img { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
        .addon-mandatory-badge { font-size: .68rem; font-weight: 700; padding: 2px 7px; border-radius: 20px; background: var(--brand); color: #fff; margin-left: 6px; }
      `}</style>
    </div>
  );
};
