import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";

interface SchemaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}
interface QueryResult {
  ok: true;
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowsAffected: number;
  lastInsertRowid: number | null;
  elapsedMs: number;
  truncated: boolean;
}
interface QueryError {
  error: string;
  code: string;
}

const SAMPLE = "SELECT * FROM users LIMIT 50;";

export function AdminDbEditor(): React.ReactElement {
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [statement, setStatement] = useState(() => {
    try { return localStorage.getItem("nx.db-editor.stmt") ?? SAMPLE; } catch { return SAMPLE; }
  });
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    api("/api/admin/db/schema")
      .then((r) => r.json())
      .then((d: { tables: SchemaTable[] }) => setTables(d.tables ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    try { localStorage.setItem("nx.db-editor.stmt", statement); } catch { /* ignore */ }
  }, [statement]);

  const run = useCallback(async () => {
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api("/api/admin/db/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement }),
      });
      const data = (await r.json()) as QueryResult | QueryError;
      if (!r.ok || "error" in data) {
        setErr("error" in data ? data.error : `HTTP ${r.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [statement]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd + Enter = run query (common SQL-tool convention).
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
    },
    [run],
  );

  const insertTableQuery = (name: string) => {
    setStatement(`SELECT * FROM "${name}" LIMIT 50;`);
    taRef.current?.focus();
  };

  const totalRows = result?.rows.length ?? 0;
  const moreCount = result?.truncated ? "+" : "";

  return (
    <div style={styles.shell}>
      <aside style={styles.side}>
        <div style={styles.sideTitle}>
          <Icon name="database" size={14} /> Schema
        </div>
        <div style={styles.sideList}>
          {tables.length === 0 ? (
            <div style={styles.muted}>loading…</div>
          ) : (
            tables.map((t) => (
              <details key={t.name} style={styles.tbl}>
                <summary
                  style={styles.tblName}
                  onDoubleClick={() => insertTableQuery(t.name)}
                  title="Double-click to insert SELECT"
                >
                  {t.name}
                </summary>
                <ul style={styles.cols}>
                  {t.columns.map((c) => (
                    <li key={c.name} style={styles.col}>
                      <span style={styles.colName}>{c.name}</span>
                      <span style={styles.colType}>{c.type}{c.pk ? " 🔑" : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </div>
      </aside>

      <section style={styles.main}>
        <div style={styles.toolbar}>
          <button type="button" onClick={run} disabled={running} style={styles.btnPrimary}>
            {running ? "Running…" : "Run (Ctrl+Enter)"}
          </button>
          <span style={styles.warn} title="Write queries land in audit_log immediately">
            full-SQL · all writes audited
          </span>
        </div>
        <textarea
          ref={taRef}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          style={styles.editor}
          placeholder="SELECT * FROM users LIMIT 50;"
        />

        {err ? (
          <div style={styles.err}>
            <Icon name="alert-triangle" size={14} /> {err}
          </div>
        ) : null}

        {result ? (
          <div style={styles.resultWrap}>
            <div style={styles.resultMeta}>
              {result.columns.length > 0
                ? `${totalRows}${moreCount} rows · ${result.elapsedMs}ms`
                : `${result.rowsAffected} row(s) affected · ${result.elapsedMs}ms`}
              {result.truncated ? " · truncated at 5000" : ""}
            </div>
            {result.columns.length > 0 ? (
              <div style={styles.grid}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c} style={styles.th}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => (
                          <td key={c} style={styles.td}>{formatCell(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
  return String(v);
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: "grid", gridTemplateColumns: "240px 1fr", gap: 12, minHeight: 480 },
  side: { borderRight: "1px solid var(--border, #2a2a2a)", paddingRight: 8, overflow: "auto", maxHeight: 600 },
  sideTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted, #888)", padding: "4px 6px" },
  sideList: { display: "flex", flexDirection: "column", gap: 2 },
  tbl: { padding: "2px 6px" },
  tblName: { cursor: "pointer", fontFamily: "ui-monospace, monospace", fontSize: 12 },
  cols: { listStyle: "none", padding: "4px 0 4px 12px", margin: 0, fontSize: 11 },
  col: { display: "flex", justifyContent: "space-between", color: "var(--muted, #888)" },
  colName: { fontFamily: "ui-monospace, monospace" },
  colType: { opacity: 0.6 },
  muted: { color: "var(--muted, #888)", fontSize: 12, padding: "6px" },
  main: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  toolbar: { display: "flex", alignItems: "center", gap: 12 },
  btnPrimary: { padding: "6px 14px", background: "var(--accent, #3b82f6)", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" },
  warn: { fontSize: 11, color: "var(--muted, #888)" },
  editor: {
    fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
    fontSize: 13,
    padding: 10,
    minHeight: 140,
    background: "var(--bg-elevated, #111)",
    color: "var(--fg, #ddd)",
    border: "1px solid var(--border, #2a2a2a)",
    borderRadius: 6,
    resize: "vertical",
  },
  err: { padding: 8, background: "rgba(220,40,40,0.1)", border: "1px solid rgba(220,40,40,0.4)", borderRadius: 6, fontSize: 12 },
  resultWrap: { display: "flex", flexDirection: "column", gap: 6 },
  resultMeta: { fontSize: 11, color: "var(--muted, #888)" },
  grid: { overflow: "auto", maxHeight: 480, border: "1px solid var(--border, #2a2a2a)", borderRadius: 6 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 12 },
  th: { textAlign: "left", pading: "6px 10px", background: "var(--bg-elevated, #1a1a1a)", position: "sticky", top: 0, fontWeight: 600 },
  td: { padding: "4px 10px", borderTop: "1px solid var(--border, #222)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" },
};

export default AdminDbEditor;