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
  "settings.email.fail": { label: "Email credential rotation refused (bad password)", tone: "bad" },
  // Anti-fraud blocklist + allowlist (migration 0008). Adds are "warn"
  // because tightening the gate is legitimate but worth seeing in the
  // log; removes are "warn" too because they loosen protection.
  "blacklist.add": { label: "Added blacklist entry", tone: "warn" },
  "blacklist.remove": { label: "Removed blacklist entry", tone: "warn" },
  "whitelist.add": { label: "Added whitelist entry", tone: "warn" },
  "whitelist.remove": { label: "Removed whitelist entry", tone: "warn" },
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
  // Customer auth events. The actor on these rows is `auth:<email>`
  // so they're greppable per-account. Login.fail / login.locked /
  // login.banned / login.2fa_fail / register.dup are "bad" because they
  // surface credential-stuffing, account-lockout, or compromise probes.
  // login.ok / register / logout are "neutral" — legitimate flow events.
  "login.ok": { label: "Customer signed in", tone: "neutral" },
  "login.fail": { label: "Bad password attempt", tone: "bad" },
  "login.locked": { label: "Account locked (too many fails)", tone: "bad" },
  "login.2fa_fail": { label: "Bad 2FA code", tone: "bad" },
  "login.banned": { label: "Banned account login attempt", tone: "bad" },
  register: { label: "Customer registered", tone: "neutral" },
  "register.dup": { label: "Duplicate registration attempt", tone: "warn" },
  logout: { label: "Customer signed out", tone: "neutral" },
  // Customer password reset flow (migration 0009 + /forgot+/reset routes).
  // Throttled / miss don't confirm the email exists — they're surfaced
  // anyway so an operator grepping for probing patterns can see them.
  "forgot.sent": { label: "Reset link sent", tone: "neutral" },
  "forgot.miss": { label: "Reset attempt — unknown email", tone: "warn" },
  "forgot.throttled": { label: "Reset attempt throttled", tone: "warn" },
  "reset.ok": { label: "Customer reset password via link", tone: "warn" },
  "reset.miss": { label: "Reset failed — token not found", tone: "warn" },
  "reset.replay": { label: "Reset link replay attempt", tone: "bad" },
  "reset.expired": { label: "Reset link expired", tone: "neutral" },
  "reset.bad_token_shape": { label: "Reset link malformed", tone: "warn" },
  "reset.user_gone": { label: "Reset against deleted user", tone: "warn" },
  // Customer self-service password change (logged-in flow). Counterpart
  // of the admin account.password.* keys — "warn" on success because a
  // password rotation is legitimate but worth seeing, "bad" on the
  // bad-current path because that's the credential-stuffing signature.
  "change_password.ok": { label: "Customer changed password", tone: "warn" },
  "change_password.bad_current": {
    label: "Customer change-password refused (bad current)",
    tone: "bad",
  },
  // Customer self-service email change. The "ok" event renames the
  // primary key on an account so it's "warn" — legitimate but worth
  // surfacing. bad_current is "bad" (credential-stuffing signature),
  // taken/same just record the rejection without a tone hit.
  "change_email.ok": { label: "Customer changed email", tone: "warn" },
  "change_email.bad_current": {
    label: "Customer change-email refused (bad current)",
    tone: "bad",
  },
  "change_email.same": { label: "Change-email no-op (same address)", tone: "neutral" },
  "change_email.taken": { label: "Change-email refused (already in use)", tone: "warn" },
  // GDPR Art. 17 self-service erasure. ok is "warn" because deleting
  // an account is legitimate but worth surfacing (an operator scanning
  // the audit log probably cares); bad_current is "bad" — same
  // credential-stuffing signature as the other rotation flows.
  "account.delete.ok": { label: "Customer deleted account", tone: "warn" },
  "account.delete.bad_current": {
    label: "Account-delete refused (bad current)",
    tone: "bad",
  },
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
