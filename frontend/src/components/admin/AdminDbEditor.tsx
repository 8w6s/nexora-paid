import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../../lib/api";
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
interface AuditRow {
  id: number;
  at: number;
  actor_email: string | null;
  actor_ip: string | null;
  action: string;
  target: string | null;
  statement: string | null;
  rows_affected: number | null;
  elapsed_ms: number | null;
  success: number;
  error: string | null;
}

type Pane = "query" | "audit";

const SAMPLE = "SELECT * FROM users LIMIT 50;";

export function AdminDbEditor(): React.ReactElement {
  const [pane, setPane] = useState<Pane>("query");
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [statement, setStatement] = useState(() => {
    try { return localStorage.getItem("nx.db-editor.stmt") ?? SAMPLE; } catch { return SAMPLE; }
  });
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    api
      .get<{ tables: SchemaTable[] }>("/api/admin/db/schema")
      .then((d) => setTables(d.tables ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    try { localStorage.setItem("nx.db-editor.stmt", statement); } catch { /* ignore */ }
  }, [statement]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const d = await api.get<{ rows: AuditRow[] }>("/api/admin/db/audit?limit=200");
      setAuditRows(d.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pane === "audit") loadAudit();
  }, [pane, loadAudit]);

  const run = useCallback(async () => {
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const data = await api.post<QueryResult>("/api/admin/db/query", { statement });
      setResult(data);
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setErr(e.message);
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRunning(false);
    }
  }, [statement]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        <div style={styles.tabs}>
          <button
            type="button"
            style={{ ...styles.tab, ...(pane === "query" ? styles.tabActive : {}) }}
            onClick={() => setPane("query")}
          >
            SQL
          </button>
          <button
            type="button"
            style={{ ...styles.tab, ...(pane === "audit" ? styles.tabActive : {}) }}
            onClick={() => setPane("audit")}
          >
            Audit log
          </button>
        </div>

        {pane === "query" ? (
          <>
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
          </>
        ) : (
          <div style={styles.auditWrap}>
            <div style={styles.toolbar}>
              <button type="button" onClick={loadAudit} disabled={auditLoading} style={styles.btnPrimary}>
                {auditLoading ? "Loading…" : "Refresh"}
              </button>
              <span style={styles.warn}>Latest 200 entries, newest first</span>
            </div>
            {auditRows.length === 0 ? (
              <div style={styles.muted}>
                {auditLoading ? "Loading…" : "No audit entries yet — run a query in the SQL tab."}
              </div>
            ) : (
              <div style={styles.grid}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>When</th>
                      <th style={styles.th}>Actor</th>
                      <th style={styles.th}>Action</th>
                      <th style={styles.th}>Statement</th>
                      <th style={styles.th}>Rows</th>
                      <th style={styles.th}>ms</th>
                      <th style={styles.th}>OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((r) => (
                      <tr key={r.id}>
                        <td style={styles.td} title={new Date(r.at).toISOString()}>
                          {new Date(r.at).toLocaleString()}
                        </td>
                <td style={styles.td}>{r.actor_email ?? "—"}</td>
                        <td style={styles.td}>{r.action}</td>
                        <td style={{ ...styles.td, whiteSpace: "normal", maxWidth: 480 }}>
                          <code style={styles.code}>{r.statement ?? ""}</code>
                          {r.error ? <div style={styles.errInline}>{r.error}</div> : null}
                        </td>
                        <td style={styles.td}>{r.rows_affected ?? "—"}</td>
                        <td style={styles.td}>{r.elapsed_ms ?? "—"}</td>
                        <td style={styles.td}>{r.success ? "✓" : "✗"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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
  tabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--border, #2a2a2a)", marginBottom: 4 },
  tab: { padding: "6px 14px", background: "transparent", color: "var(--muted, #888)", border: 0, borderBottom: "2px solid transparent", cursor: "pointer" },
  tabActive: { color: "var(--fg, #ddd)", borderBottomColor: "var(--accent, #3b82f6)" },
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
  errInline: { fontSize: 11, color: "#e57373", marginTop: 4 },
  resultWrap: { display: "flex", flexDirection: "column", gap: 6 },
  resultMeta: { fontSize: 11, color: "var(--muted, #888)" },
  auditWrap: { display: "flex", flexDirection: "column", gap: 6 },
  grid: { overflow: "auto", maxHeight: 480, border: "1px solid var(--border, #2a2a2a)", borderRadius: 6 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 12 },
  th: { textAlign: "left", padding: "6px 10px", background: "var(--bg-elevated, #1a1a1a)", position: "sticky", top: 0, fontWeight: 600 },
  td: { padding: "4px 10px", borderTop: "1px solid var(--border, #222)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" },
  code: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--fg, #ddd)" },
};

export default AdminDbEditor;