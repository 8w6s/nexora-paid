import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, api } from "../../lib/api";
import { Icon } from "../Icon";
import "./AdminDbEditor.css";

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
    try {
      return localStorage.getItem("nx.db-editor.stmt") ?? SAMPLE;
    } catch {
      return SAMPLE;
    }
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
    try {
      localStorage.setItem("nx.db-editor.stmt", statement);
    } catch {
      /* ignore */
    }
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
    <div className="nx-dbe">
      <aside className="nx-dbe__side">
        <div className="nx-dbe__side-title">
          <Icon name="database" size={13} /> Schema
        </div>
        <div className="nx-dbe__side-list">
          {tables.length === 0 ? (
            <div className="nx-dbe__muted">loading…</div>
          ) : (
            tables.map((t) => (
              <details key={t.name} className="nx-dbe__tbl">
                <summary
                  className="nx-dbe__tbl-name"
                  onDoubleClick={() => insertTableQuery(t.name)}
                  title="Double-click to insert SELECT"
                >
                  {t.name}
                </summary>
                <ul className="nx-dbe__cols">
                  {t.columns.map((c) => (
                    <li key={c.name} className="nx-dbe__col">
                      <span className="nx-dbe__col-name">{c.name}</span>
                      <span className="nx-dbe__col-type">
                        {c.type.toLowerCase()}
                        {c.pk ? <span className="nx-dbe__col-pk">PK</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </div>
      </aside>

      <section className="nx-dbe__main">
        <div className="nx-dbe__tabs">
          <button
            type="button"
            className={`nx-dbe__tab${pane === "query" ? " nx-dbe__tab--active" : ""}`}
            onClick={() => setPane("query")}
          >
            SQL Query
          </button>
          <button
            type="button"
            className={`nx-dbe__tab${pane === "audit" ? " nx-dbe__tab--active" : ""}`}
            onClick={() => setPane("audit")}
          >
            Audit Log
          </button>
        </div>

        {pane === "query" ? (
          <>
            <div className="nx-dbe__toolbar">
              <button type="button" onClick={run} disabled={running} className="nx-dbe__btn">
                {running ? (
                  "Running…"
                ) : (
                  <>
                    Run<span className="nx-dbe__kbd">Ctrl+↵</span>
                  </>
                )}
              </button>
              <span className="nx-dbe__hint" title="Write queries land in audit_log immediately">
                full-SQL access · all writes audited
              </span>
            </div>
            <textarea
              ref={taRef}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              className="nx-dbe__editor"
              placeholder="SELECT * FROM users LIMIT 50;"
            />

            {err ? (
              <div className="nx-dbe__err">
                <Icon name="alert-triangle" size={14} /> {err}
              </div>
            ) : null}

            {result ? (
              <div className="nx-dbe__result">
                <div className="nx-dbe__result-meta nx-dbe__result-meta--ok">
                  {result.columns.length > 0 ? (
                    <>
                      <strong>
                        {totalRows}
                        {moreCount}
                      </strong>{" "}
                      rows · <strong>{result.elapsedMs}</strong>ms
                    </>
                  ) : (
                    <>
                      <strong>{result.rowsAffected}</strong> row(s) affected ·{" "}
                      <strong>{result.elapsedMs}</strong>ms
                    </>
                  )}
                  {result.truncated ? <span> · truncated at 5000</span> : null}
                </div>
                {result.columns.length > 0 ? (
                  <div className="nx-dbe__grid">
                    <table className="nx-dbe__table">
                      <thead>
                        <tr>
                          {result.columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i}>
                            {result.columns.map((c) => (
                              <td key={c}>{formatCell(row[c])}</td>
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
          <div className="nx-dbe__result">
            <div className="nx-dbe__toolbar">
              <button
                type="button"
                onClick={loadAudit}
                disabled={auditLoading}
                className="nx-dbe__btn"
              >
                {auditLoading ? "Loading…" : "Refresh"}
              </button>
              <span className="nx-dbe__hint">Latest 200 entries, newest first</span>
            </div>
            {auditRows.length === 0 ? (
              <div className="nx-dbe__muted">
                {auditLoading ? "Loading…" : "No audit entries yet — run a query in the SQL tab."}
              </div>
            ) : (
              <div className="nx-dbe__grid">
                <table className="nx-dbe__table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Statement</th>
                      <th>Rows</th>
                      <th>ms</th>
                      <th>OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((r) => (
                      <tr key={r.id}>
                        <td title={new Date(r.at).toISOString()}>
                          {new Date(r.at).toLocaleString()}
                        </td>
                        <td>{r.actor_email ?? <span className="nx-dbe__null">—</span>}</td>
                        <td>{r.action}</td>
                        <td className="nx-dbe__audit-cell-stmt">
                          <code className="nx-dbe__code">{r.statement ?? ""}</code>
                          {r.error ? <div className="nx-dbe__err-inline">{r.error}</div> : null}
                        </td>
                        <td>{r.rows_affected ?? <span className="nx-dbe__null">—</span>}</td>
                        <td>{r.elapsed_ms ?? <span className="nx-dbe__null">—</span>}</td>
                        <td className={r.success ? "nx-dbe__ok" : "nx-dbe__bad"}>
                          {r.success ? "✓" : "✗"}
                        </td>
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

function formatCell(v: unknown): React.ReactNode {
  if (v == null) return <span className="nx-dbe__null">null</span>;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
  return String(v);
}

export default AdminDbEditor;
