import type React from "react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { useAuthOptional } from "./AuthContext";
import { Icon } from "./Icon";
import { SkeletonStyles, SkRows } from "./Skeleton";

interface Ticket {
  id: string;
  subject: string;
  status: "open" | "closed";
  createdAt: number;
  updatedAt: number;
}
interface Message {
  id: string;
  fromAdmin: boolean;
  body: string;
  createdAt: number;
}
interface TicketDetail extends Ticket {
  email: string;
  orderId: string | null;
  messages: Message[];
}

export const MyTickets: React.FC = () => {
  const { t } = useT();
  // Same auth gating as MyOrders — avoid console-noise 401 for guests.
  const auth = useAuthOptional();
  const [list, setList] = useState<Ticket[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [active, setActive] = useState<TicketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = () => {
    api
      .get<Ticket[]>("/api/tickets")
      .then((tt) => {
        setList(tt);
        setNeedLogin(false);
      })
      .catch((e) => {
        if (e instanceof ApiRequestError && e.status === 401) setNeedLogin(true);
        else setErr(e.message);
      });
  };
  useEffect(() => {
    // Skip the fetch (and its inevitable 401) when we already know the
    // user is a guest. Hydration: wait one tick if auth is still loading.
    if (auth) {
      if (auth.loading) return;
      if (!auth.user) {
        setNeedLogin(true);
        return;
      }
    }
    loadList();
  }, [auth?.user?.id, auth?.loading]);

  const openThread = async (id: string) => {
    setErr(null);
    try {
      const data = await api.get<TicketDetail>(`/api/tickets/${id}`);
      setActive(data);
      setView("thread");
      const url = new URL(window.location.href);
      if (url.searchParams.get("id") !== id) {
        url.searchParams.set("id", id);
        window.history.pushState({}, "", url.pathname + url.search);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("storefront.tickets.loadFailed"));
    }
  };

  useEffect(() => {
    const handleUrlSync = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      if (id) {
        if (active?.id !== id) {
          openThread(id);
        }
      } else {
        setView("list");
        setActive(null);
      }
    };
    handleUrlSync();
    window.addEventListener("popstate", handleUrlSync);
    return () => window.removeEventListener("popstate", handleUrlSync);
  }, [active?.id, openThread]);

  const goBack = () => {
    setView("list");
    setActive(null);
    setErr(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("id")) {
      url.searchParams.delete("id");
      const search = url.search ? url.search : "";
      window.history.pushState({}, "", url.pathname + search);
    }
  };

  const createTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { id } = await api.post<{ id: string }>("/api/tickets", {
        subject: subject.trim(),
        message: message.trim(),
      });
      setSubject("");
      setMessage("");
      loadList();
      await openThread(id);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("storefront.tickets.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/tickets/${active.id}/reply`, { message: reply.trim() });
      setReply("");
      await openThread(active.id);
      loadList();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("storefront.tickets.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (s: "open" | "closed") =>
    s === "open" ? t("storefront.tickets.statusOpen") : t("storefront.tickets.statusClosed");

  if (needLogin)
    return (
      <main className="container tk-page">
        <div className="tk-state">{t("storefront.tickets.pleaseSignIn")}</div>
        <Styles />
      </main>
    );
  if (list === null && !err)
    return (
      <main className="container tk-page">
        <h1>{t("storefront.tickets.title")}</h1>
        <SkRows count={3} height={72} />
        <SkeletonStyles />
        <Styles />
      </main>
    );

  return (
    <main className="container tk-page">
      <div className="tk-head">
        <h1>{t("storefront.tickets.title")}</h1>
        {view === "list" && (
          <button
            className="btn"
            onClick={() => {
              setView("new");
              setErr(null);
            }}
          >
            <Icon name="plus" size={15} /> {t("storefront.tickets.newTicket")}
          </button>
        )}
        {view !== "list" && (
          <button className="btn-ghost" onClick={goBack}>
            <Icon name="arrow-right" size={14} className="flip" /> {t("common.back")}
          </button>
        )}
      </div>

      {err && <div className="tk-err">{err}</div>}

      {view === "list" &&
        (list && list.length === 0 ? (
          <div className="tk-empty card">
            <span className="tk-empty-icon">
              <Icon name="ticket" size={28} variant="badge" />
            </span>
            <h2>{t("storefront.tickets.emptyTitle")}</h2>
            <p>{t("storefront.tickets.emptyHint")}</p>
            <button className="btn" onClick={() => setView("new")}>
              <Icon name="plus" size={15} /> {t("storefront.tickets.openTicket")}
            </button>
          </div>
        ) : (
          <div className="tk-list">
            {list?.map((tk) => (
              <button key={tk.id} className="tk card" onClick={() => openThread(tk.id)}>
                <div className="tk-row">
                  <Icon name="ticket" size={16} variant="badge" />
                  <span className="tk-subj">{tk.subject}</span>
                  <span className={`badge ${tk.status}`}>{statusLabel(tk.status)}</span>
                </div>
                <span className="muted">
                  {t("storefront.tickets.updatedAt", {
                    when: new Date(tk.updatedAt).toLocaleString(),
                  })}
                </span>
              </button>
            ))}
          </div>
        ))}

      {view === "new" && (
        <form method="post" className="tk-form card" onSubmit={createTicket}>
          <label>
            <span>{t("storefront.tickets.subject")}</span>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              placeholder={t("storefront.tickets.subjectPlaceholder")}
            />
          </label>
          <label>
            <span>{t("storefront.tickets.message")}</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={5}
              placeholder={t("storefront.tickets.messagePlaceholder")}
            />
          </label>
          <button
            className="btn"
            disabled={busy || !subject.trim() || !message.trim()}
            type="submit"
          >
            {busy ? (
              <>
                <Icon name="spinner" size={15} className="is-spinning" /> {t("common.loading")}
              </>
            ) : (
              t("storefront.tickets.createTicket")
            )}
          </button>
        </form>
      )}

      {view === "thread" && active && (
        <div className="tk-thread">
          <div className="tk-thread-head card">
            <h2>{active.subject}</h2>
            <span className={`badge ${active.status}`}>{statusLabel(active.status)}</span>
          </div>
          <div className="tk-msgs">
            {active.messages.map((m) => (
              <div key={m.id} className={`msg ${m.fromAdmin ? "admin" : "me"}`}>
                <div className="msg-meta">
                  {m.fromAdmin
                    ? t("storefront.tickets.fromSupport")
                    : t("storefront.tickets.fromYou")}{" "}
                  · {new Date(m.createdAt).toLocaleString()}
                </div>
                <div className="msg-body">{m.body}</div>
              </div>
            ))}
          </div>
          {active.status === "open" ? (
            <form method="post" className="tk-reply card" onSubmit={sendReply}>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                required
                rows={3}
                placeholder={t("storefront.tickets.replyPlaceholder")}
              />
              <button className="btn" disabled={busy || !reply.trim()} type="submit">
                {busy ? (
                  <>
                    <Icon name="spinner" size={15} className="is-spinning" /> {t("common.loading")}
                  </>
                ) : (
                  t("storefront.tickets.sendReply")
                )}
              </button>
            </form>
          ) : (
            <p className="tk-closed">{t("storefront.tickets.ticketClosed")}</p>
          )}
        </div>
      )}

      <Styles />
    </main>
  );
};

const Styles: React.FC = () => (
  <style>{`
    .tk-page { width: 100%; padding: 36px 20px; max-width: 720px; margin: 0 auto; }
    .tk-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .tk-head h1 { font-size: 1.5rem; }
    .btn-ghost { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: var(--ink-soft); font-weight: 600; font-size: .86rem; cursor: pointer; font-family: var(--font-sans); }
    .btn-ghost:hover { color: var(--brand); }
    .btn-ghost .flip { transform: rotate(180deg); }
    .linkbtn { background: none; border: none; color: var(--brand); font-weight: 600; cursor: pointer; font-family: var(--font-sans); padding: 0; }
    .tk-err { background: var(--err-soft,#fdecea); color: var(--err,#c0392b); padding: 9px 14px; border-radius: var(--radius-sm); font-size: .84rem; margin-bottom: 14px; }
    .tk-state { padding: 50px 20px; text-align: center; color: var(--ink-soft); }
    .tk-state a, .tk-state .linkbtn { color: var(--brand); font-weight: 600; }
    .tk-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 24px; text-align: center; }
    .tk-empty h2 { font-size: 1.2rem; font-weight: 700; color: var(--ink); }
    .tk-empty p { color: var(--ink-soft); font-size: .9rem; max-width: 380px; line-height: 1.5; }
    .tk-empty .btn { margin-top: 6px; }
    .tk-list { display: flex; flex-direction: column; gap: 12px; }
    .tk { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; text-align: left; cursor: pointer; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius); font-family: var(--font-sans); }
    .tk:hover { box-shadow: var(--shadow-hover); }
    .tk-row { display: flex; align-items: center; gap: 10px; }
    .tk-subj { flex: 1; font-weight: 600; color: var(--ink); }
    .muted { font-size: .78rem; color: var(--ink-faint); }
    .tk-form { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
    .tk-form label { display: flex; flex-direction: column; gap: 6px; font-size: .85rem; font-weight: 600; color: var(--ink-soft); }
    .tk-form textarea, .tk-reply textarea { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 10px 12px; font-family: var(--font-sans); font-size: .9rem; resize: vertical; color: var(--ink); background: var(--surface-2); outline: none; }
    .tk-form textarea:focus, .tk-reply textarea:focus { border-color: var(--brand); }
    .tk-form .btn { align-self: flex-start; }
    .tk-thread-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; margin-bottom: 14px; }
    .tk-thread-head h2 { font-size: 1.1rem; }
    .tk-msgs { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
    .msg { max-width: 82%; padding: 10px 14px; border-radius: var(--radius); font-size: .9rem; }
    .msg.me { align-self: flex-end; background: var(--brand-soft,rgba(79,70,229,.1)); }
    .msg.admin { align-self: flex-start; background: var(--surface); border: 1px solid var(--line); }
    .msg-meta { font-size: .72rem; color: var(--ink-faint); margin-bottom: 4px; }
    .msg-body { line-height: 1.55; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
    .tk-reply { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
    .tk-reply .btn { align-self: flex-start; }
    .tk-closed { text-align: center; color: var(--ink-faint); padding: 16px; }
    .badge { padding: 4px 11px; border-radius: 100px; font-size: .74rem; font-weight: 600; }
    .badge.open { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
    .badge.closed { color: var(--ink-faint); background: var(--surface-2); }
  `}</style>
);
