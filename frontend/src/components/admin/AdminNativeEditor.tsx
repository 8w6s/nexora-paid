import type React from "react";
import { useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";

/**
 * AdminNativeEditor — placeholder for no-SQL CRUD UI.
 * Backend at /api/admin/tables is already complete; this stub mounts
 * the table list and links out to the DB editor for now.
 */
export function AdminNativeEditor(): React.ReactElement {
  const [tables, setTables] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ tables: Array<{ name: string }> }>("/api/admin/db/schema")
      .then((d) => {
        setTables((d.tables ?? []).map((t) => t.name).filter((n) => !n.startsWith("sqlite_") && n !== "_migrations" && n !== "audit_log"));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const openRow = useCallback((name: string) => {
    location.hash = "#db-editor";
    setTimeout(() => {
      const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (ta) ta.value = `SELECT * FROM "${name}" LIMIT 50;`;
    }, 100);
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}><Icon name="table" size={16} /> Native Editor</h3>
      <p style={{ color: "var(--muted, #888)", fontSize: 13 }}>
        No-SQL CRUD with type-aware widgets is in progress. For now, pick a table below to open it in the SQL pane.
      </p>
      {err ? <div style={{ padding: 8, background: "rgba(220,40,40,0.1)", borderRadius: 6 }}>{err}</div> : null}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
        {tables.map((t) => (
          <li key={t}>
            <button
              type="button"
              onClick={() => openRow(t)}
              style={{ width: "100%", padding: "8px 12px", background: "var(--bg-elevated, #1a1a1a)", border: "1px solid var(--border, #2a2a2a)", color: "var(--fg, #ddd)", borderRadius: 6, cursor: "pointer", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            >
              {t}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AdminNativeEditor;
