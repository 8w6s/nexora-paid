import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { ConfirmModal } from "./ConfirmModal";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

interface CustomerSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ipAddress: string | null;
  lastIp: string | null;
  userAgent: string | null;
  current: boolean;
}

function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("OPR/")
      ? "Opera"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Chrome/")
          ? "Chrome"
          : ua.includes("Safari/")
            ? "Safari"
            : "Browser";
  const os = ua.includes("Windows NT")
    ? "Windows"
    : ua.includes("Mac OS X")
      ? "macOS"
      : ua.includes("Android")
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : ua.includes("Linux")
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

export const AccountSessionsCard: React.FC = () => {
  const { t } = useT();
  const toast = useToast();
  const [list, setList] = useState<CustomerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get<{ sessions: CustomerSession[] }>("/api/auth/sessions")
      .then((r) => setList(r?.sessions ?? []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const doRevokeOthers = async () => {
    setConfirmAction(null);
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/auth/sessions/revoke-others",
        {},
      );
      const n = res?.revokedSessions ?? 0;
      toast.success(
        n > 0
          ? t("storefront.sessions.revokedCount", { count: n })
          : t("storefront.sessions.noOthers"),
      );
      load();
    } catch (err) {
      if (err instanceof ApiRequestError) toast.error(err.message);
      else toast.error(t("storefront.sessions.revokeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doRevokeOne = async (id: string) => {
    setConfirmAction(null);
    try {
      await api.post(`/api/auth/sessions/${id}/revoke`, {});
      toast.success(t("storefront.sessions.deviceSignedOut"));
      load();
    } catch (err) {
      if (err instanceof ApiRequestError) toast.error(err.message);
      else toast.error(t("storefront.sessions.revokeFailed"));
    }
  };


  const [confirmAction, setConfirmAction] = useState<{
    type: "others" | "one";
    id?: string;
  } | null>(null);

  const revokeOthers = () => setConfirmAction({ type: "others" });
  const revokeOne = (id: string) => setConfirmAction({ type: "one", id });

  const others = list.filter((s) => !s.current).length;

  return (
    <section className="card sessions-card">
      <header className="sessions-head">
        <div>
          <h2>{t("storefront.sessions.title")}</h2>
          <p className="sub">{t("storefront.sessions.hint")}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={revokeOthers}
          disabled={busy || others === 0}
        >
          {busy ? (
            <>
              <Icon name="spinner" size={14} className="is-spinning" />
              <span>{t("common.loading")}</span>
            </>
          ) : (
            <>
              <Icon name="close" size={14} />
              <span>{t("storefront.sessions.signOutOthers")}</span>
            </>
          )}
        </button>
      </header>

      {loading ? (
        <div className="sessions-loading">
          <Icon name="spinner" size={20} className="is-spinning" />
        </div>
      ) : list.length === 0 ? (
        <p className="muted">{t("storefront.sessions.empty")}</p>
      ) : (
        <ul className="sessions-list">
          {list.map((s) => (
            <li key={s.id} className={s.current ? "is-current" : ""}>
              <div className="sessions-row">
                <div className="sessions-meta">
                  <div className="sessions-device">
                    <span title={s.userAgent ?? ""}>{summarizeUserAgent(s.userAgent)}</span>
                    {s.current && (
                      <span className="sessions-badge">{t("storefront.sessions.thisDevice")}</span>
                    )}
                  </div>
                  <div className="sessions-detail">
                    <code>{s.lastIp ?? s.ipAddress ?? t("storefront.sessions.unknownIp")}</code>
                    <span className="sessions-dot">·</span>
                    <span>
                      {t("storefront.sessions.lastSeen", {
                        when: new Date(s.lastSeenAt).toLocaleString(),
                      })}
                    </span>
                  </div>
                  {s.lastIp && s.ipAddress && s.lastIp !== s.ipAddress && (
                    <div className="sessions-roam">
                      {t("storefront.sessions.startedFrom")} <code>{s.ipAddress}</code>
                    </div>
                  )}
                </div>
                {!s.current && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => revokeOne(s.id)}
                    aria-label={t("storefront.sessions.signOutThisDevice")}
                  >
                    {t("storefront.sessions.signOut")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .sessions-card { padding: 26px 28px; }
        .sessions-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
        .sessions-head h2 { font-size: 1.15rem; margin-bottom: 4px; }
        .sub { color: var(--ink-soft); font-size: .86rem; }
        .muted { color: var(--ink-soft); font-size: .85rem; }
        .sessions-loading { display: flex; justify-content: center; padding: 18px 0; }
        .sessions-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .sessions-list li { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); transition: border-color .15s var(--ease); }
        .sessions-list li.is-current { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 6%, var(--surface)); }
        .sessions-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .sessions-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
        .sessions-device { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: .92rem; color: var(--ink); }
        .sessions-badge { background: var(--brand); color: #fff; font-size: .68rem; padding: 2px 8px; border-radius: 100px; font-weight: 700; letter-spacing: .02em; }
        .sessions-detail { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: .8rem; color: var(--ink-soft); }
        .sessions-detail code { background: var(--surface-2); padding: 1px 6px; border-radius: 4px; font-size: .76rem; }
        .sessions-dot { opacity: .5; }
        .sessions-roam { font-size: .75rem; color: var(--ink-faint); margin-top: 2px; }
        .sessions-roam code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-size: .72rem; }
      `}</style>

      <ConfirmModal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.type === "others") doRevokeOthers();
          else if (confirmAction?.type === "one" && confirmAction.id) doRevokeOne(confirmAction.id);
        }}
        title={
          confirmAction?.type === "others"
            ? t("storefront.sessions.confirmRevokeOthers")
            : t("storefront.sessions.confirmRevokeOne")
        }
        message={
          confirmAction?.type === "others"
            ? t("storefront.sessions.confirmRevokeOthersMsg")
            : t("storefront.sessions.confirmRevokeOneMsg")
        }
        danger
      />
    </section>
  );
};
