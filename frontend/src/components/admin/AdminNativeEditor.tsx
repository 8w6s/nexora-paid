import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiRequestError } from "../../lib/api";
import { Icon } from "../Icon";
import "./AdminNativeEditor.css";

interface SchemaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

interface TableData {
  columns: SchemaColumn[];
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZES = [25, 50, 100, 200];

export function AdminNativeEditor(): React.ReactElement {
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);
  const [order, setOrder] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [q, setQ] = useState<string>("");
  const [qDebounced, setQDebounced] = useState<string>("");
  const [editing, setEditing] = useState<{
    mode: "insert" | "edit";
    rowid?: number;
    values: Record<string, unknown>;
  } | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Load schema once
  useEffect(() => {
    api
      .get<{ tables: SchemaTable[] }>("/api/admin/db/schema")
      .then((d) => {
        const list = (d.tables ?? []).filter(
          (t) => !t.name.startsWith("sqlite_") && t.name !== "_migrations" && t.name !== "audit_log",
        );
        setTables(list);
        if (list.length && !selected) setSelected(list[0].name);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // Load table data on selection / pagination change
  const loadTable = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (order) {
        params.set("order", order);
        params.set("dir", dir);
      }
      if (qDebounced) params.set("q", qDebounced);
      const d = await api.get<TableData>(`/api/admin/db/table/${encodeURIComponent(selected)}?${params}`);
      setData(d);
    } catch (e) {
      if (e instanceof ApiRequestError) setErr(e.message);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selected, limit, offset, order, dir, qDebounced]);

  useEffect(() => {
    loadTable();
  }, [loadTable]);

  // Reset state when switching tables or query changes
  useEffect(() => {
    setOffset(0);
    setOrder(null);
    setDir("asc");
    setQ("");
  }, [selected]);

  useEffect(() => {
    setOffset(0);
  }, [qDebounced]);

  const sortBy = (col: string) => {
    if (order === col) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setOrder(col);
      setDir("asc");
    }
  };

  const startInsert = () => {
    if (!data) return;
    const empty: Record<string, unknown> = {};
    for (const c of data.columns) empty[c.name] = c.dflt_value ?? "";
    setEditing({ mode: "insert", values: empty });
  };

  const startEdit = (row: Record<string, unknown>) => {
    if (!data) return;
    const values: Record<string, unknown> = {};
    for (const c of data.columns) values[c.name] = row[c.name] ?? null;
    setEditing({ mode: "edit", rowid: Number(row._rowid), values });
  };

  const deleteRow = async (row: Record<string, unknown>) => {
    if (!selected) return;
    if (!confirm("Delete this row? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/admin/db/table/${encodeURIComponent(selected)}/row`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowid: Number(row._rowid) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      await loadTable();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submitEdit = async () => {
    if (!selected || !editing) return;
    try {
      // Strip auto-managed columns from insert payload
      const cleanValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editing.values)) {
        // For insert: skip empty PK with INTEGER type so SQLite auto-assigns
        if (editing.mode === "insert") {
          const col = data?.columns.find((c) => c.name === k);
          if (col?.pk && (v === "" || v == null)) continue;
        }
        cleanValues[k] = v === "" ? null : v;
      }
      if (editing.mode === "insert") {
        await api.post(`/api/admin/db/table/${encodeURIComponent(selected)}/row`, { data: cleanValues });
      } else {
        await api.patch(`/api/admin/db/table/${encodeURIComponent(selected)}/row`, {
          rowid: editing.rowid,
          data: cleanValues,
        });
      }
      setEditing(null);
      await loadTable();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const visibleCols = useMemo(() => data?.columns.filter((c) => c.name !== "_rowid") ?? [], [data]);

  return (
    <div className="nx-nae">
      <aside className="nx-nae__side">
        <div className="nx-nae__side-title">
          <Icon name="database" size={13} /> Tables ({tables.length})
        </div>
        {tables.map((t) => (
          <button
            key={t.name}
            type="button"
            className={`nx-nae__tbl-btn${selected === t.name ? " nx-nae__tbl-btn--active" : ""}`}
            onClick={() => setSelected(t.name)}
          >
            <Icon name="table" size={11} /> {t.name}
          </button>
        ))}
      </aside>

      <section className="nx-nae__main">
        <div className="nx-nae__header">
          <div>
            <h2 className="nx-nae__title">{selected ?? "—"}</h2>
            {data ? (
              <div className="nx-nae__meta">
                {data.total.toLocaleString()} rows · {visibleCols.length} columns
              </div>
            ) : null}
          </div>
          <div className="nx-nae__toolbar">
            <input
              type="search"
              placeholder="Search text columns…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="nx-nae__search"
            />
            <button
              type="button"
              onClick={loadTable}
              disabled={loading}
              className="nx-nae__btn nx-nae__btn--ghost"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={startInsert}
              disabled={!data}
              className="nx-nae__btn"
            >
              + Insert row
            </button>
          </div>
        </div>

        {err ? <div className="nx-nae__err">{err}</div> : null}

        {!data || data.rows.length === 0 ? (
          <div className="nx-nae__empty">
            {loading ? "Loading…" : data?.rows.length === 0 ? "Table is empty." : "Select a table to view rows."}
          </div>
        ) : (
          <>
            <div className="nx-nae__grid">
              <table className="nx-nae__table">
                <thead>
                  <tr>
                    <th className="nx-nae__th-actions">Actions</th>
                    {visibleCols.map((c) => (
                      <th key={c.name} onClick={() => sortBy(c.name)} title={`${c.type}${c.pk ? " (PK)" : ""}`}>
                        {c.name}
                        {order === c.name ? (
                          <span className="nx-nae__sort">{dir === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={Number(row._rowid)}>
                      <td className="nx-nae__cell-actions">
                        <button
                          type="button"
                className="nx-nae__btn-icon"
                          onClick={() => startEdit(row)}
                          title="Edit row"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="nx-nae__btn-icon nx-nae__btn-icon--danger"
                          onClick={() => deleteRow(row)}
                          title="Delete row"
                        >
                          ×
                        </button>
                      </td>
                      {visibleCols.map((c) => (
                        <td key={c.name} title={String(row[c.name] ?? "")}>
                          {formatCell(row[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="nx-nae__pagi">
              <span className="nx-nae__pagi-info">
                Showing {offset + 1}–{Math.min(offset + data.rows.length, data.total)} of {data.total.toLocaleString()}
              </span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setOffset(0);
                }}
                className="nx-nae__btn nx-nae__btn--ghost"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="nx-nae__btn nx-nae__btn--ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                ‹ Prev
              </button>
              <button
                type="button"
                className="nx-nae__btn nx-nae__btn--ghost"
                disabled={offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
              >
                Next ›
              </button>
            </div>
          </>
        )}
      </section>

      {editing ? (
        <div className="nx-nae__modal-bg" onClick={() => setEditing(null)}>
          <div className="nx-nae__modal" onClick={(e) => e.stopPropagation()}>
            <div className="nx-nae__modal-head">
              <h3 className="nx-nae__modal-title">
                {editing.mode === "insert" ? "Insert row" : `Edit row #${editing.rowid}`} — {selected}
              </h3>
              <button type="button" className="nx-nae__btn-icon" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="nx-nae__modal-body">
              {visibleCols.map((c) => {
                const v = editing.values[c.name];
                const isLong = typeof v === "string" && v.length > 80;
                return (
                  <div key={c.name} className="nx-nae__field">
                    <label className="nx-nae__field-label">
                      <span>
                        {c.name}
                        {c.pk ? <span className="nx-nae__field-pk">PK</span> : null}
                      </span>
                      <span className="nx-nae__field-type">
                        {c.type.toLowerCase()}
                        {c.notnull ? " · required" : " · nullable"}
                      </span>
                    </label>
                {isLong || /text|json|blob/i.test(c.type) ? (
                      <textarea
                        className="nx-nae__field-textarea"
                        value={v == null ? "" : String(v)}
                        onChange={(e) =>
                          setEditing({ ...editing, values: { ...editing.values, [c.name]: e.target.value } })
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        className="nx-nae__field-input"
                        value={v == null ? "" : String(v)}
                        onChange={(e) =>
                          setEditing({ ...editing, values: { ...editing.values, [c.name]: e.target.value } })
                        }
                      />
                    )}
                    {!c.notnull ? (
                      <label className="nx-nae__field-null">
                        <input
                          type="checkbox"
                          checked={v == null}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              values: { ...editing.values, [c.name]: e.target.checked ? null : "" },
                            })
                          }
                        />
                        NULL
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="nx-nae__modal-foot">
              <button type="button" className="nx-nae__btn nx-nae__btn--ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="nx-nae__btn" onClick={submitEdit}>
                {editing.mode === "insert" ? "Insert" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatCell(v: unknown): React.ReactNode {
  if (v == null) return <span className="nx-nae__null">null</span>;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export default AdminNativeEditor;