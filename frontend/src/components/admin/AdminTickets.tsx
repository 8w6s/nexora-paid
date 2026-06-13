import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { Sk, SkeletonStyles } from "../Skeleton";

interface Ticket {
  id: string;
  subject: string;
  email: string;
  status: "open" | "closed";
  createdAt: number;
  updatedAt: number;
  orderId: string | null;
}
interface Message {
  id: string;
  fromAdmin: boolean;
  body: string;
  createdAt: number;
}
interface TicketDetail extends Ticket {
  messages: Message[];
}

export const AdminTickets: React.FC = () => {
  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");
  const [list, setList] = useState<Ticket[] | null>(null);
  const [active, setActive] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    const qs = filter === "all" ? "" : `?status=${filter}`;
    api
      .get<Ticket[]>(`/api/admin/tickets${qs}`)
      .then(setList)
      .catch(() => {});
  };
  useEffect(load, [filter]);

  const open = async (id: string) => {
    setActive(await api.get<TicketDetail>(`/api/tickets/${id}`));
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    try {
      await api.post(`/api/tickets/${active.id}/reply`, { message: reply.trim() });
      setReply("");
      await open(active.id);
      load();
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: "open" | "closed") => {
    if (!active) return;
    setBusy(true);
    try {
      await api.put(`/api/admin/tickets/${active.id}/status`, { status });
      setActive({ ...active, status });
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atk">
      <SkeletonStyles />
      <div className={`atk-grid ${active ? "has-active" : ""}`}>
        <div className="atk-left">
          <div className="atk-filters">
            {(["open", "closed", "all"] as const).map((f) => (
              <button
                key={f}
                className={`chip ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="atk-list">
            {!list ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="atk-item">
                  <Sk w={180} h={13} />
                  <Sk w={120} h={11} />
                </div>
              ))
            ) : list.length === 0 ? (
              <div className="empty">No tickets.</div>
            ) : (
              list.map((t) => (
                <button
                  key={t.id}
                  className={`atk-item ${active?.id === t.id ? "sel" : ""}`}
                  onClick={() => open(t.id)}
                >
                  <div className="atk-item-top">
                    <span className="subj">{t.subject}</span>
                    <span className={`badge ${t.status}`}>{t.status}</span>
                  </div>
                  <span className="muted">
                    {t.email} · {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="atk-right card">
          {!active ? (
            <div className="atk-empty">
              <Icon name="ticket" size={28} variant="badge" />
              <p>Select a ticket to view the conversation.</p>
            </div>
          ) : (
            <>
              <div className="atk-head">
                <button
                  className="atk-back"
                  onClick={() => setActive(null)}
                  aria-label="Back to list"
                >
                  <Icon name="arrow-right" size={14} className="flip" />
                </button>
                <div>
                  <h3>{active.subject}</h3>
                  <span className="muted">
                    {active.email}
                    {active.orderId ? ` · order ${active.orderId}` : ""}
                  </span>
                </div>
                {active.status === "open" ? (
                  <button className="btn-sm" disabled={busy} onClick={() => setStatus("closed")}>
                    Close
                  </button>
                ) : (
                  <button
                    className="btn-sm ghost"
                    disabled={busy}
                    onClick={() => setStatus("open")}
                  >
                    Reopen
                  </button>
                )}
              </div>
              <div className="atk-msgs">
                {active.messages.map((m) => (
                  <div key={m.id} className={`msg ${m.fromAdmin ? "admin" : "cust"}`}>
                    <div className="msg-meta">
                      {m.fromAdmin ? "You (support)" : active.email} ·{" "}
                      {new Date(m.createdAt).toLocaleString()}
                    </div>
                    <div className="msg-body">{m.body}</div>
                  </div>
                ))}
              </div>
              {active.status === "open" && (
                <form className="atk-reply" onSubmit={sendReply}>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    required
                    rows={3}
                    placeholder="Reply to the customer…"
                  />
                  <button className="btn" disabled={busy || !reply.trim()} type="submit">
                    {busy ? "Sending…" : "Send reply"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        .atk-grid { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
        .atk-filters { display: flex; gap: 8px; margin-bottom: 12px; }
        .chip { background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink-soft); padding: 5px 13px; border-radius: 100px; cursor: pointer; font-family: var(--font-sans); font-weight: 600; font-size: .8rem; }
        .chip.active { background: var(--brand); color: #fff; border-color: var(--brand); }
        .atk-list { display: flex; flex-direction: column; gap: 8px; }
        .atk-item { display: flex; flex-direction: column; gap: 5px; text-align: left; padding: 11px 13px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; font-family: var(--font-sans); }
        .atk-item.sel { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft,rgba(79,70,229,.12)); }
        .atk-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .subj { font-weight: 600; font-size: .86rem; color: var(--ink); }
        .muted { font-size: .76rem; color: var(--ink-faint); }
        .empty { text-align: center; color: var(--ink-faint); padding: 30px; font-size: .85rem; }
        .atk-right { min-height: 360px; padding: 18px 20px; }
        .atk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 320px; color: var(--ink-faint); }
        .atk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
        .atk-head h3 { font-size: 1.05rem; }
        .btn-sm { background: var(--price); color: #fff; border: none; padding: 7px 14px; border-radius: 100px; font-weight: 600; font-size: .8rem; cursor: pointer; font-family: var(--font-sans); }
        .btn-sm.ghost { background: var(--surface-2); color: var(--ink-soft); }
        .btn-sm:disabled { opacity: .5; }
        .atk-msgs { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; max-height: 360px; overflow-y: auto; }
        .msg { max-width: 80%; padding: 9px 13px; border-radius: var(--radius); font-size: .88rem; }
        .msg.admin { align-self: flex-end; background: var(--brand-soft,rgba(79,70,229,.1)); }
        .msg.cust { align-self: flex-start; background: var(--surface-2); }
        .msg-meta { font-size: .7rem; color: var(--ink-faint); margin-bottom: 3px; }
        .msg-body { line-height: 1.5; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
        .atk-reply { display: flex; flex-direction: column; gap: 10px; }
        .atk-reply textarea { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 10px 12px; font-family: var(--font-sans); font-size: .9rem; resize: vertical; color: var(--ink); background: var(--surface-2); outline: none; }
        .atk-reply textarea:focus { border-color: var(--brand); }
        .atk-reply .btn { align-self: flex-start; }
        .badge { padding: 3px 10px; border-radius: 100px; font-size: .7rem; font-weight: 600; }
        .badge.open { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.closed { color: var(--ink-faint); background: var(--surface-2); }
        .atk-back { display: none; background: var(--surface-2); border: none; width: 30px; height: 30px; border-radius: 50%; align-items: center; justify-content: center; cursor: pointer; color: var(--ink-soft); flex-shrink: 0; }
        .atk-back:hover { background: var(--brand-soft); color: var(--brand); }
        .atk-back .flip { transform: rotate(180deg); }
        @media (max-width: 720px) {
          .atk-grid { grid-template-columns: 1fr; }
          /* Master-detail collapse: when a ticket is selected, show only the
             detail pane and surface a back button to return to the list. */
          .atk-grid.has-active .atk-left { display: none; }
          .atk-grid.has-active .atk-back { display: inline-flex; }
          .atk-grid:not(.has-active) .atk-right { display: none; }
        }
      `}</style>
    </div>
  );
};
