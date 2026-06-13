import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Sk, SkeletonStyles } from "../Skeleton";

interface Action {
  id: string;
  adminEmail: string;
  action: string;
  detail: string | null;
  createdAt: number;
}

// Map action keys to a human label + tone.
const META: Record<string, { label: string; tone: string }> = {
  "product.create": { label: "Created product", tone: "good" },
  "product.deactivate": { label: "Deactivated product", tone: "warn" },
  // Cluster F bulk + export actions land here so the activity log
  // shows real labels instead of raw "product.bulk_deactivate" keys.
  "product.bulk_activate": { label: "Bulk-activated products", tone: "good" },
  "product.bulk_deactivate": { label: "Bulk-deactivated products", tone: "warn" },
  "orders.csv_export": { label: "Exported orders CSV", tone: "neutral" },
  "customers.csv_export": { label: "Exported customers CSV", tone: "neutral" },
  "customer.ban": { label: "Banned customer", tone: "bad" },
  "customer.unban": { label: "Unbanned customer", tone: "good" },
  "coupon.create": { label: "Created coupon", tone: "good" },
  "review.hide": { label: "Hid review", tone: "warn" },
  "review.unhide": { label: "Unhid review", tone: "good" },
  "review.delete": { label: "Deleted review", tone: "bad" },
  "ticket.close": { label: "Closed ticket", tone: "warn" },
  "ticket.reopen": { label: "Reopened ticket", tone: "good" },
};

export const AdminActivity: React.FC = () => {
  const [list, setList] = useState<Action[] | null>(null);

  useEffect(() => {
    api
      .get<Action[]>("/api/admin/activity")
      .then(setList)
      .catch(() => setList([]));
  }, []);

  return (
    <div className="act">
      <SkeletonStyles />
      <p className="intro">Audit trail of admin actions (most recent first, last 200).</p>
      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {!list ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Sk w={140} h={13} />
                    </td>
                    <td>
                      <Sk w={150} h={13} />
                    </td>
                    <td>
                      <Sk w={120} h={20} r={100} />
                    </td>
                    <td>
                      <Sk w={180} h={13} />
                    </td>
                  </tr>
                ))
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    No admin activity recorded yet.
                  </td>
                </tr>
              ) : (
                list.map((a) => {
                  const m = META[a.action] ?? { label: a.action, tone: "neutral" };
                  return (
                    <tr key={a.id}>
                      <td className="muted sm">{new Date(a.createdAt).toLocaleString()}</td>
                      <td className="email">{a.adminEmail}</td>
                      <td>
                        <span className={`tag ${m.tone}`}>{m.label}</span>
                      </td>
                      <td className="detail">{a.detail ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`
        .act .intro { color: var(--ink-soft); font-size: .88rem; margin-bottom: 14px; }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 11px 14px; border-bottom: 1px solid var(--line); }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .email { font-weight: 600; font-size: .85rem; }
        .muted { color: var(--ink-soft); } .sm { font-size: .8rem; }
        .detail { font-size: .85rem; color: var(--ink-soft); }
        .empty { text-align: center; color: var(--ink-faint); padding: 40px; }
        .tag { padding: 4px 11px; border-radius: 100px; font-size: .74rem; font-weight: 600; white-space: nowrap; }
        .tag.good { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .tag.warn { color: var(--warn,#b25e00); background: var(--warn-soft,#fff4e5); }
        .tag.bad { color: var(--price); background: var(--price-soft); }
        .tag.neutral { color: var(--ink-soft); background: var(--surface-2); }
      `}</style>
    </div>
  );
};
