import type React from "react";
import { useEffect, useState } from "react";
import { api, fmtUsd } from "../../lib/api";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { Sk, SkeletonStyles } from "../Skeleton";
import { useToast } from "../Toast";
import { AdminProductEditor, type ProductRow } from "./AdminProductEditor";
import { AdminProductWizard } from "./AdminProductWizard";

interface AdminProduct extends ProductRow {}

export const AdminProducts: React.FC = () => {
  const [list, setList] = useState<AdminProduct[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit";
    product: AdminProduct | null;
  } | null>(null);
  const [keysFor, setKeysFor] = useState<AdminProduct | null>(null);
  const [keysText, setKeysText] = useState("");
  const [keysVariantId, setKeysVariantId] = useState("");
  const [keysType, setKeysType] = useState<"code" | "account" | "file" | "instructions">("code");
  const [wizard, setWizard] = useState(false);
  const toast = useToast();

  const load = () =>
    api
      .get<AdminProduct[]>("/api/admin/products")
      .then(setList)
      .catch(() => {})
      .finally(() => setLoaded(true));
  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (p: AdminProduct) => {
    await api.patch(`/api/admin/products/${p.id}`, { active: !p.active });
    load();
  };
  const uploadKeys = async () => {
    if (!keysFor) return;
    const codes = keysText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.length === 0) return;
    try {
      const payload: Record<string, any> = { codes, keyType: keysType };
      if (keysVariantId) payload.variantId = keysVariantId;
      const r = await api.post<{ added: number; duplicatesSkipped: number }>(
        `/api/admin/products/${keysFor.id}/keys`,
        payload,
      );
      toast.success(`Added ${r.added} key(s), skipped ${r.duplicatesSkipped} duplicate(s).`);
      setKeysText("");
      setKeysFor(null);
      setKeysVariantId("");
      setKeysType("code");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  if (wizard) {
    return (
      <AdminProductWizard
        onCancel={() => setWizard(false)}
        onDone={() => {
          setWizard(false);
          toast.success("Product published.");
          load();
        }}
      />
    );
  }

  if (editor) {
    return (
      <AdminProductEditor
        product={editor.product}
        onDone={(savedMsg) => {
          setEditor(null);
          if (savedMsg) toast.success(savedMsg);
          load();
        }}
      />
    );
  }

  return (
    <div className="ap">
      <SkeletonStyles />
      <div className="ap-bar">
        <button
          className="btn btn-ghost"
          onClick={() => setEditor({ mode: "create", product: null })}
        >
          <Icon name="plus" size={16} /> Blank product
        </button>
        <button className="btn" onClick={() => setWizard(true)}>
          <Icon name="plus" size={16} /> New product (guided)
        </button>
      </div>
      <div className="ap-grid single">
        <div className="card table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Cat</th>
                  <th className="num">Price</th>
                  <th className="num">Avail</th>
                  <th className="num">Sold</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!loaded &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`sk${i}`}>
                      <td>
                        <div className="pcell">
                          <Sk w={36} h={36} r={6} />
                          <Sk w={140} h={13} />
                        </div>
                      </td>
                      <td>
                        <Sk w={56} h={18} r={100} />
                      </td>
                      <td className="num">
                        <Sk w={48} h={13} style={{ marginLeft: "auto" }} />
                      </td>
                      <td className="num">
                        <Sk w={28} h={13} style={{ marginLeft: "auto" }} />
                      </td>
                      <td className="num">
                        <Sk w={28} h={13} style={{ marginLeft: "auto" }} />
                      </td>
                      <td>
                        <Sk w={56} h={22} r={100} />
                      </td>
                      <td>
                        <Sk w={64} h={13} />
                      </td>
                    </tr>
                  ))}
                {loaded &&
                  list.map((p) => (
                    <tr key={p.id} className={p.active ? "" : "inactive"}>
                      <td>
                        <div className="pcell">
                          <img src={p.image} alt="" />
                          <strong>{p.name}</strong>
                        </div>
                      </td>
                      <td>
                        <span className="pill">{p.category}</span>
                      </td>
                      <td className="num price">{fmtUsd(p.priceUsd)}</td>
                      <td className="num">{p.available}</td>
                      <td className="num muted">{p.sold}</td>
                      <td>
                        <button
                          className={`badge ${p.active ? "on" : "off"}`}
                          onClick={() => toggleActive(p)}
                        >
                          {p.active ? "Active" : "Hidden"}
                        </button>
                      </td>
                      <td className="row-actions">
                        <button
                          className="lnk icon-btn"
                          onClick={() => setEditor({ mode: "edit", product: p })}
                          aria-label={`Edit ${p.name}`}
                          title="Edit"
                        >
                          <Icon name="pencil" size={15} variant="duotone-regular" />
                        </button>
                        <button
                          className="lnk icon-btn"
                          onClick={() => {
                            setKeysFor(p);
                            setKeysText("");
                            setKeysVariantId("");
                            setKeysType("code");
                          }}
                          aria-label={`Manage keys for ${p.name}`}
                          title="Manage keys"
                        >
                          <Icon name="key" size={15} variant="duotone-regular" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={!!keysFor}
        onClose={() => setKeysFor(null)}
        title={keysFor ? `Add keys — ${keysFor.name}` : ""}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setKeysFor(null)}>
              Cancel
            </button>
            <button className="btn" onClick={uploadKeys}>
              <Icon name="plus" size={14} /> Upload keys
            </button>
          </>
        }
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "14px" }}
        >
          {keysFor?.variants && keysFor.variants.length > 0 && (
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                fontSize: ".82rem",
                fontWeight: "600",
              }}
            >
              <span>Assign to Variant</span>
              <select
                className="input"
                value={keysVariantId}
                onChange={(e) => setKeysVariantId(e.target.value)}
              >
                <option value="">— General / Product Direct —</option>
                {keysFor.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({fmtUsd(v.priceUsd)})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              fontSize: ".82rem",
              fontWeight: "600",
            }}
          >
            <span>Key Type</span>
            <select
              className="input"
              value={keysType}
              onChange={(e) => setKeysType(e.target.value as any)}
            >
              <option value="code">Serial / Code</option>
              <option value="account">Account (user:pass)</option>
              <option value="file">File (URL)</option>
              <option value="instructions">Instructions / Content</option>
            </select>
          </label>
        </div>

        <p className="muted">One code per line. Duplicates are skipped automatically.</p>
        <textarea
          className="input"
          rows={8}
          value={keysText}
          onChange={(e) => setKeysText(e.target.value)}
          placeholder={keysType === "account" ? "user1:pass1\nuser2:pass2" : "CODE-1\nCODE-2\n…"}
        />
      </Modal>

      <style>{`
        .ap { position: relative; }
        .ap-bar { display: flex; justify-content: flex-end; margin-bottom: 14px; }
        .ap-grid { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
        .ap-bar { gap: 8px; }
        .form-actions { display: flex; gap: 8px; margin-top: 4px; }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { color: var(--ink-soft); }
        tr.inactive { opacity: .5; }
        .pcell { display: flex; align-items: center; gap: 9px; }
        .pcell img { width: 36px; height: 36px; object-fit: cover; border-radius: var(--radius-sm); }
        .pcell strong { font-size: .86rem; }
        .badge { border: none; cursor: pointer; padding: 4px 10px; border-radius: 100px; font-size: .72rem; font-weight: 600; }
        .badge.on { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.off { color: var(--ink-faint); background: var(--surface-2); }
        .row-actions { display: flex; gap: 8px; }
        .lnk { background: none; border: none; color: var(--brand); cursor: pointer; font-weight: 600; font-size: .82rem; }
        .icon-btn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; transition: background .15s var(--ease); }
        .icon-btn:hover { background: var(--brand-soft); }
      `}</style>
    </div>
  );
};
