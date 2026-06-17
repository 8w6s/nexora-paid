import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";

interface AbandonedCheckout {
  id: string;
  email: string;
  productName: string;
  amount: number;
  currency: string;
  createdAt: string;
  recoveryEmailSent: boolean;
  status: "abandoned" | "recovered";
}

export const AdminAbandonedCheckouts: React.FC = () => {
  const [checkouts, setCheckouts] = useState<AbandonedCheckout[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<AbandonedCheckout[]>("/api/admin/abandoned-checkouts")
      .catch(() => [] as AbandonedCheckout[])
      .then(setCheckouts)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const sendRecovery = async (id: string) => {
    setSending(id);
    try {
      await api.post(`/api/admin/abandoned-checkouts/${id}/recover`, {});
      load();
    } catch {
    } finally {
      setSending(null);
    }
  };

  const fmtDate = (d: string) => new Date(d).toLocaleString();

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Abandoned Checkouts</h2>
          <p className="muted">Track and recover abandoned checkout sessions.</p>
        </div>
        <button className="btn btn-ghost" onClick={load}>
          <Icon name="spinner" size={14} /> Refresh
        </button>
      </div>

      <div className="adm-stats-row">
        <div className="adm-stat-card card">
          <span className="adm-stat-label">Total Abandoned</span>
          <span className="adm-stat-value">{checkouts.length}</span>
        </div>
        <div className="adm-stat-card card">
          <span className="adm-stat-label">Recovered</span>
          <span className="adm-stat-value" style={{ color: "var(--success)" }}>
            {checkouts.filter((c) => c.status === "recovered").length}
          </span>
        </div>
        <div className="adm-stat-card card">
          <span className="adm-stat-label">Recovery Emails Sent</span>
          <span className="adm-stat-value">
            {checkouts.filter((c) => c.recoveryEmailSent).length}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={24} className="is-spinning" />
        </div>
      ) : checkouts.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No Abandoned Checkouts"
          message="When customers start checkout and don't complete it, they'll appear here."
        />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
                <th>Recovery</th>
              </tr>
            </thead>
            <tbody>
              {checkouts.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>{c.productName}</td>
                  <td>
                    {c.currency} {c.amount.toFixed(2)}
                  </td>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td>
                    <span
                      className={`badge ${c.status === "recovered" ? "badge-green" : "badge-yellow"}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {c.status !== "recovered" && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => sendRecovery(c.id)}
                        disabled={sending === c.id || c.recoveryEmailSent}
                        title={
                          c.recoveryEmailSent
                            ? "Recovery email already sent"
                            : "Send recovery email"
                        }
                      >
                        {sending === c.id ? (
                          <>
                            <Icon name="spinner" size={12} className="is-spinning" /> Sending…
                          </>
                        ) : c.recoveryEmailSent ? (
                          <>
                            <Icon name="check" size={12} /> Sent
                          </>
                        ) : (
                          <>
                            <Icon name="receipt" size={12} /> Send Recovery
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .adm-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .adm-stat-card { padding: 16px 20px; display: flex; flex-direction: column; gap: 4px; }
        .adm-stat-label { font-size: .78rem; font-weight: 600; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .06em; }
        .adm-stat-value { font-size: 1.8rem; font-weight: 700; color: var(--ink); }
        .badge-yellow { background: rgba(234,179,8,.12); color: #92400e; border: 1px solid rgba(234,179,8,.3); }
        @media (max-width: 640px) { .adm-stats-row { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};
