import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { ConfirmModal } from "../ConfirmModal";
import { Dropdown } from "../Dropdown";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { Sk, SkeletonStyles } from "../Skeleton";
import { useToast } from "../Toast";
import { ImagePicker } from "./ImagePicker";

interface Cat {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string;
  image: string;
  sortOrder: number;
  productCount: number;
}

interface FormState {
  id?: string;
  name: string;
  slug: string;
  parentId: string;
  description: string;
  image: string;
}
const blank: FormState = { name: "", slug: "", parentId: "", description: "", image: "" };

// Build a nested view-model from the flat list. Each row carries its depth so
// the table can indent rendered names.
interface RowVM extends Cat {
  depth: number;
}
function buildTree(rows: Cat[]): RowVM[] {
  const byParent: Record<string, Cat[]> = {};
  for (const r of rows) {
    const k = r.parentId ?? "";
    (byParent[k] ??= []).push(r);
  }
  const out: RowVM[] = [];
  const walk = (parentId: string, depth: number) => {
    const list = byParent[parentId] ?? [];
    for (const r of list) {
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export const AdminCategories: React.FC = () => {
  const [list, setList] = useState<Cat[] | null>(null);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingCat, setDeletingCat] = useState<Cat | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    api
      .get<Cat[]>("/api/admin/categories")
      .then(setList)
      .catch((e) => {
        setList([]);
        toast.error(e instanceof Error ? e.message : "Failed to load categories");
      });
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => (list ? buildTree(list) : []), [list]);

  // Parents allowed in the dropdown: every category EXCEPT the one being
  // edited or any of its descendants (to prevent cycles).
  const parentOptions = useMemo(() => {
    if (!list) return [];
    if (!editing?.id) return list;
    const blocked = new Set<string>([editing.id]);
    let added = true;
    while (added) {
      added = false;
      for (const c of list) {
        if (c.parentId && blocked.has(c.parentId) && !blocked.has(c.id)) {
          blocked.add(c.id);
          added = true;
        }
      }
    }
    return list.filter((c) => !blocked.has(c.id));
  }, [list, editing]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name: editing.name,
        description: editing.description,
        image: editing.image,
        parentId: editing.parentId || null,
      };
      if (editing.slug.trim()) body.slug = editing.slug.trim();
      if (editing.id) await api.patch(`/api/admin/categories/${editing.id}`, body);
      else await api.post("/api/admin/categories", body);
      setEditing(null);
      toast.success(editing.id ? "Category updated." : "Category created.");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = (c: Cat) => setDeletingCat(c);
  const confirmRemove = async () => {
    if (!deletingCat) return;
    try {
      await api.del(`/api/admin/categories/${deletingCat.id}`);
      setDeletingCat(null);
      load();
      toast.success("Category deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="cats">
      <SkeletonStyles />
      <div className="cats-bar">
        <p className="intro">Organize products into a browsable hierarchy, up to 4 levels deep.</p>
        <button className="btn" onClick={() => setEditing({ ...blank })}>
          <Icon name="plus" size={15} /> New category
        </button>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th className="num">Products</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!list ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Sk w={160} h={13} />
                    </td>
                    <td>
                      <Sk w={120} h={13} />
                    </td>
                    <td className="num">
                      <Sk w={24} h={13} style={{ marginLeft: "auto" }} />
                    </td>
                    <td>
                      <Sk w={60} h={13} />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    No categories yet. Create one to start.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="name-cell" style={{ paddingLeft: 14 + r.depth * 24 }}>
                      {r.depth > 0 && <span className="branch">└</span>}
                      <span className="name">{r.name}</span>
                    </td>
                    <td className="muted slug">/{r.slug}</td>
                    <td className="num">{r.productCount}</td>
                    <td className="actions">
                      <button
                        className="icon-btn"
                        title="Edit"
                        aria-label={`Edit ${r.name}`}
                        onClick={() =>
                          setEditing({
                            id: r.id,
                            name: r.name,
                            slug: r.slug,
                            parentId: r.parentId ?? "",
                            description: r.description,
                            image: r.image,
                          })
                        }
                      >
                        <Icon name="pencil" size={14} variant="duotone-regular" />
                      </button>
                      <button
                        className="icon-btn del"
                        title="Delete"
                        aria-label={`Delete ${r.name}`}
                        onClick={() => remove(r)}
                      >
                        <Icon name="trash" size={14} variant="duotone-regular" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit category" : "Create category"}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(null)} type="button">
              Cancel
            </button>
            <button className="btn" onClick={save} disabled={busy || !editing?.name.trim()}>
              {busy ? (
                <>
                  <Icon name="spinner" size={15} className="is-spinning" /> Saving…
                </>
              ) : editing?.id ? (
                "Save changes"
              ) : (
                "Create"
              )}
            </button>
          </>
        }
      >
        {editing && (
          <>
            <div className="grid-2">
              <label>
                <span>Name</span>
                <input
                  className="input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  required
                />
              </label>
              <label>
                <span>
                  URL path <em>(optional)</em>
                </span>
                <input
                  className="input"
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  placeholder={
                    editing.name
                      ? editing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
                      : "category-url-path"
                  }
                />
              </label>
            </div>
            <label>
              <span>Parent category</span>
              <Dropdown<string>
                value={editing.parentId}
                onChange={(v) => setEditing({ ...editing, parentId: v })}
                options={[
                  { value: "", label: "— Top level —", icon: "home" },
                  ...parentOptions.map((c) => ({
                    value: c.id,
                    label: c.name,
                    icon: "box" as const,
                  })),
                ]}
                width="100%"
              />
            </label>
            <label>
              <span>Description</span>
              <textarea
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={3}
              />
            </label>
            <label>
              <span>Category image <em>(optional)</em></span>
              <ImagePicker
                value={editing.image}
                onChange={(u) => setEditing({ ...editing, image: u })}
              />
            </label>
            {err && <div className="err">{err}</div>}
          </>
        )}
      </Modal>

      <style>{`
        .cats .intro { color: var(--ink-soft); font-size: .88rem; }
        .cats-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .name-cell { display: flex; align-items: center; gap: 8px; }
        .name-cell .branch { color: var(--ink-faint); font-family: monospace; }
        .name-cell .name { font-weight: 600; font-size: .9rem; }
        .muted { color: var(--ink-soft); }
        .slug { font-family: monospace; font-size: .82rem; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .empty { text-align: center; color: var(--ink-faint); padding: 40px; }
        .actions { display: flex; gap: 6px; justify-content: flex-end; }
        .icon-btn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; background: none; border: none; color: var(--brand); cursor: pointer; transition: background .15s var(--ease); }
        .icon-btn:hover { background: var(--brand-soft); }
        .icon-btn.del { color: var(--price); }
        .icon-btn.del:hover { background: var(--price-soft); }

        .m-box label { display: flex; flex-direction: column; gap: 5px; font-size: .85rem; font-weight: 600; color: var(--ink-soft); }
        .m-box label em { font-weight: 400; color: var(--ink-faint); font-style: normal; }
        .m-box textarea { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 10px 12px; font-family: var(--font-sans); font-size: .9rem; resize: vertical; color: var(--ink); background: var(--surface-2); outline: none; }
        .m-box textarea:focus { border-color: var(--brand); }
        .m-box select { cursor: pointer; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 480px) { .grid-2 { grid-template-columns: 1fr; } }
        .err { background: var(--price-soft); color: var(--price); padding: 9px 12px; border-radius: var(--radius-sm); font-size: .84rem; }
        .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
      `}</style>

      <ConfirmModal
        open={!!deletingCat}
        onClose={() => setDeletingCat(null)}
        onConfirm={confirmRemove}
        title="Delete Category"
        message={`Delete category "${deletingCat?.name}"? This only works if it has no subcategories or products.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
};
