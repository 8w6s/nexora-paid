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

// Map action keys to a human label + tone. Anything not listed here
// renders the raw key with neutral tone — better to fall through than
// silently hide a security-sensitive action because nobody added a label.
const META: Record<string, { label: string; tone: string }> = {
  "product.create": { label: "Created product", tone: "good" },
  "product.deactivate": { label: "Deactivated product", tone: "warn" },
  // Bulk + export actions land here so the activity log shows real labels
  // instead of raw "product.bulk_deactivate" keys.
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
  // Settings / configuration. settings.update fires on the catch-all
  // schema-driven PUT; the wallet-specific labels distinguish a financial-
  // key change from a cosmetic one so an operator scanning the log can
  // tell at a glance which writes mattered.
  "settings.update": { label: "Updated settings", tone: "neutral" },
  "settings.email.update": { label: "Updated email settings", tone: "neutral" },
  "settings.wallet.fail": { label: "Wallet rotation refused (bad password)", tone: "bad" },
  "payment.config": { label: "Updated payment provider", tone: "neutral" },
  "payment.wallet.fail": { label: "Wallet rotation refused (bad password)", tone: "bad" },
  "keys.upload": { label: "Uploaded inventory keys", tone: "good" },
  // Account & session management. Each is rendered with the strongest
  // tone matching its blast radius — a forced rotation is "bad" because
  // it bypasses the in-app flow and silently re-keys the admin.
  "account.password.rotate": { label: "Rotated own password", tone: "warn" },
  "account.password.fail": { label: "Password rotation refused (bad current)", tone: "bad" },
  "account.sessions.revoke_others": { label: "Revoked other sessions", tone: "warn" },
  "account.sessions.revoke_one": { label: "Revoked one session", tone: "warn" },
  "admin.bootstrap_force": { label: "Forced admin password rotation", tone: "bad" },
  // 2FA enrollment lifecycle. Disable / recover are "warn" because they
  // weaken the auth state; enable is "good".
  "2fa.enable": { label: "Enabled 2FA", tone: "good" },
  "2fa.disable": { label: "Disabled 2FA", tone: "warn" },
  "2fa.recover": { label: "Used 2FA backup code", tone: "warn" },
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
