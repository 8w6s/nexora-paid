import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";

interface LicenseInfo {
  valid: boolean;
  reason?: string;
  productId?: string;
  customerId?: string | null;
  issuedAt?: string;
  expiresAt?: string | null;
  features?: string[] | null;
  note?: string | null;
  emailMasked?: string;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

// Days remaining until expiry; negative = past, null = no expiry on file.
function daysLeft(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export const AdminLicenseCard: React.FC = () => {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  useEffect(() => {
    api
      .get<LicenseInfo>("/api/admin/license")
      .then(setInfo)
      .catch(() => setInfo({ valid: false, reason: "could not load" }));
  }, []);

  if (!info) return null;

  const dleft = daysLeft(info.expiresAt);
  const expiringSoon = dleft !== null && dleft <= 30 && dleft >= 0;
  const expired = dleft !== null && dleft < 0;

  const tone = !info.valid || expired ? "bad" : expiringSoon ? "warn" : "ok";

  return (
    <div className={`lic-card card lic-${tone}`}>
      <div className="lic-head">
        <span className="lic-icon">
          <Icon name="shield" size={16} />
        </span>
        <div className="lic-title">
          <strong>License</strong>
          <span className="lic-sub">
            {!info.valid
              ? `Invalid — ${info.reason ?? "unknown reason"}`
              : expired
                ? `Expired ${info.expiresAt ? fmtDate(info.expiresAt) : ""}`
                : expiringSoon
                  ? `Renews in ${dleft} day${dleft === 1 ? "" : "s"}`
                  : info.expiresAt
                    ? `Active · ${fmtDate(info.expiresAt)}`
                    : "Active · lifetime"}
          </span>
        </div>
        <span className={`lic-pill lic-pill-${tone}`}>
          {!info.valid ? "Invalid" : expired ? "Expired" : expiringSoon ? "Renew soon" : "Active"}
        </span>
      </div>

      {info.valid && (
        <div className="lic-meta">
          {info.customerId && (
            <div className="lic-row">
              <span className="lic-k">Customer</span>
              <span className="lic-v">{info.customerId}</span>
            </div>
          )}
          {info.emailMasked && (
            <div className="lic-row">
              <span className="lic-k">Issued to</span>
              <span className="lic-v">{info.emailMasked}</span>
            </div>
          )}
          {info.issuedAt && (
            <div className="lic-row">
              <span className="lic-k">Issued</span>
              <span className="lic-v">{fmtDate(info.issuedAt)}</span>
            </div>
          )}
          {info.features && info.features.length > 0 && (
            <div className="lic-row">
              <span className="lic-k">Features</span>
              <span className="lic-v">
                {info.features.map((f) => (
                  <span key={f} className="lic-feat">
                    {f}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .lic-card { padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
        .lic-head { display: flex; align-items: center; gap: 12px; }
        .lic-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lic-title { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
        .lic-title strong { font-size: .92rem; color: var(--ink); }
        .lic-sub { font-size: .78rem; color: var(--ink-soft); }
        .lic-pill { padding: 4px 10px; border-radius: 100px; font-size: .72rem; font-weight: 700; white-space: nowrap; }
        .lic-pill-ok { background: var(--auto-soft, #e6f4ea); color: var(--auto, #137333); }
        .lic-pill-warn { background: var(--warn-soft, #fff4e5); color: var(--warn, #b25e00); }
        .lic-pill-bad { background: var(--price-soft); color: var(--price); }
        .lic-ok .lic-icon { background: var(--auto-soft, #e6f4ea); color: var(--auto, #137333); }
        .lic-warn .lic-icon { background: var(--warn-soft, #fff4e5); color: var(--warn, #b25e00); }
        .lic-bad .lic-icon { background: var(--price-soft); color: var(--price); }
        .lic-meta { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--line); }
        .lic-row { display: flex; gap: 12px; font-size: .82rem; align-items: baseline; }
        .lic-k { width: 86px; color: var(--ink-faint); flex-shrink: 0; }
        .lic-v { color: var(--ink); font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); display: flex; gap: 6px; flex-wrap: wrap; }
        .lic-feat { padding: 2px 8px; border-radius: 100px; background: var(--surface-2); font-size: .72rem; font-weight: 600; color: var(--ink-soft); font-family: var(--font-sans); }
      `}</style>
    </div>
  );
};
