import type React from "react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { ApiRequestError, api } from "../lib/api";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

interface SetupResponse {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

export const Account2FACard: React.FC = () => {
  const { t } = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [disablePrompt, setDisablePrompt] = useState(false);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/auth/2fa/status")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setLoadFailed(true));
  }, []);

  const beginSetup = async () => {
    setBusy(true);
    try {
      const res = await api.get<SetupResponse>("/api/auth/2fa/setup");
      setSetup(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("storefront.twofa.setupFailed"));
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setSetup(null);
    setCode("");
  };

  const submitEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error(t("storefront.twofa.enterSixDigit"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>("/api/auth/2fa/enable", {
        code,
      });
      const revoked = res.revokedSessions ?? 0;
      toast.success(
        revoked > 0
          ? t("storefront.twofa.enabledWithRevoked", { count: revoked })
          : t("storefront.twofa.enabled"),
      );
      setEnabled(true);
      setSetup(null);
      setCode("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "INVALID_CODE") toast.error(t("storefront.twofa.invalidCode"));
        else if (err.code === "RATE_LIMITED") toast.error(t("storefront.errors.rateLimited"));
        else if (err.code === "NO_CANDIDATE") {
          toast.error(t("storefront.twofa.setupExpired"));
          setSetup(null);
        } else toast.error(err.message || t("storefront.twofa.enableFailed"));
      } else {
        toast.error(err instanceof Error ? err.message : t("storefront.twofa.enableFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error(t("storefront.twofa.enterSixDigit"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; revokedSessions: number }>(
        "/api/auth/2fa/disable",
        { code },
      );
      const revoked = res.revokedSessions ?? 0;
      toast.success(
        revoked > 0
          ? t("storefront.twofa.disabledWithRevoked", { count: revoked })
          : t("storefront.twofa.disabled"),
      );
      setEnabled(false);
      setDisablePrompt(false);
      setCode("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "INVALID_CODE") toast.error(t("storefront.twofa.invalidCode"));
        else if (err.code === "RATE_LIMITED") toast.error(t("storefront.errors.rateLimited"));
        else toast.error(err.message || t("storefront.twofa.disableFailed"));
      } else {
        toast.error(err instanceof Error ? err.message : t("storefront.twofa.disableFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("storefront.twofa.copiedLabel", { label }));
    } catch {
      toast.error(t("storefront.twofa.copyFailed"));
    }
  };

  if (loadFailed) return null;

  if (enabled === null) {
    return (
      <section className="card act-card">
        <div className="acct-head">
          <h2>{t("storefront.twofa.title")}</h2>
          <p className="sub muted">{t("common.loading")}</p>
        </div>
      </section>
    );
  }

  const backupAllString = setup?.backupCodes?.join(" ") ?? "";

  return (
    <section className="card acct-card">
      <div className="acct-head">
        <h2>{t("storefront.twofa.title")}</h2>
        <p className="sub">
          {enabled ? t("storefront.twofa.descriptionOn") : t("storefront.twofa.descriptionOff")}
        </p>
      </div>

      {!enabled && !setup && (
        <div className="acct-actions">
          <button type="button" className="btn" onClick={beginSetup} disabled={busy}>
            {busy ? (
              <>
                <Icon name="spinner" size={16} className="is-spinning" />
                <span>{t("common.loading")}</span>
              </>
            ) : (
              <>
                <Icon name="shield" size={16} />
                <span>{t("storefront.twofa.enable")}</span>
              </>
            )}
          </button>
        </div>
      )}

      {!enabled && setup && (
        <form method="post" onSubmit={submitEnable} className="setup-form">
          <div className="setup-step">
            <div className="step-num">1</div>
            <div className="step-body">
              <strong>{t("storefront.twofa.step1")}</strong>
              <p className="muted small">
                {t("storefront.twofa.orEnterSecret")}
                <code className="secret">{setup.secret}</code>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => copy(setup.secret, t("storefront.twofa.secretLabel"))}
                >
                  {t("common.copy")}
                </button>
              </p>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setup.otpauthUrl)}`}
                alt={t("storefront.twofa.qrAlt")}
                className="qr"
              />
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">2</div>
            <div className="step-body">
              <strong>{t("storefront.twofa.step2")}</strong>
              <p className="muted small">{t("storefront.twofa.backupCodesHint")}</p>
              <div className="backup-grid">
                {setup.backupCodes.map((c) => (
                  <code key={c} className="backup-code">
                    {c}
                  </code>
                ))}
              </div>
              <button
                type="button"
                className="btn-link"
                onClick={() => copy(backupAllString, t("storefront.twofa.backupCodesLabel"))}
              >
                {t("storefront.twofa.copyAll")}
              </button>
            </div>
          </div>

          <div className="setup-step">
            <div className="step-num">3</div>
            <div className="step-body">
              <strong>{t("storefront.twofa.step3")}</strong>
              <input
                className="input code-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
          </div>

          <div className="acct-actions">
            <button type="button" className="btn btn-ghost" onClick={cancelSetup} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn" disabled={busy || code.length !== 6}>
              {busy ? (
                <>
                  <Icon name="spinner" size={16} className="is-spinning" />
                  <span>{t("common.loading")}</span>
                </>
              ) : (
                <span>{t("storefront.twofa.verifyAndEnable")}</span>
              )}
            </button>
          </div>
        </form>
      )}

      {enabled && !disablePrompt && (
        <div className="acct-actions">
          <span className="enabled-badge">
            <Icon name="check" size={14} />
            <span>{t("storefront.twofa.isOn")}</span>
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setDisablePrompt(true)}>
            {t("storefront.twofa.disable")}
          </button>
        </div>
      )}

      {enabled && disablePrompt && (
        <form method="post" onSubmit={submitDisable} className="disable-form">
          <label>
            <span>{t("storefront.twofa.enterToDisable")}</span>
            <input
              className="input code-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              autoFocus
            />
          </label>
          <div className="acct-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDisablePrompt(false);
                setCode("");
              }}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn" disabled={busy || code.length !== 6}>
              {busy ? (
                <>
                  <Icon name="spinner" size={16} className="is-spinning" />
                  <span>{t("common.loading")}</span>
                </>
              ) : (
                <span>{t("storefront.twofa.confirmDisable")}</span>
              )}
            </button>
          </div>
        </form>
      )}

      <style>{`
        .acct-card { padding: 26px 28px; }
        .acct-head h2 { font-size: 1.15rem; margin-bottom: 4px; }
        .sub { color: var(--ink-soft); font-size: .86rem; line-height: 1.5; margin-bottom: 18px; }
        .acct-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 8px; }
        .enabled-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: color-mix(in srgb, #16a34a 15%, var(--surface)); color: #16a34a; border-radius: 100px; font-weight: 600; font-size: .82rem; margin-right: auto; }
        .setup-form { display: flex; flex-direction: column; gap: 18px; padding: 16px; background: var(--surface-2); border-radius: var(--radius-sm); }
        .setup-step { display: flex; gap: 14px; }
        .step-num { flex-shrink: 0; width: 28px; height: 28px; border-radius: 100px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .9rem; }
        .step-body { flex: 1; min-width: 0; }
        .step-body strong { display: block; margin-bottom: 6px; font-size: .92rem; }
        .step-body .small { font-size: .8rem; }
        .step-body .secret { display: inline-block; margin: 0 6px; padding: 2px 8px; background: var(--surface); border-radius: 4px; font-family: monospace; font-size: .82rem; user-select: all; }
        .qr { display: block; width: 200px; height: 200px; border-radius: var(--radius-sm); background: #fff; padding: 8px; margin-top: 10px; }
        .backup-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
        .backup-code { padding: 6px 8px; background: var(--surface); border-radius: 4px; font-family: monospace; font-size: .85rem; text-align: center; user-select: all; }
        .code-input { font-family: monospace; font-size: 1.1rem; letter-spacing: .15em; text-align: center; max-width: 160px; margin-top: 8px; }
        .disable-form { display: flex; flex-direction: column; gap: 14px; }
        .disable-form label { display: flex; flex-direction: column; gap: 4px; font-size: .82rem; font-weight: 600; color: var(--ink-soft); }
        .muted { color: var(--ink-soft); }
        .btn-link { background: none; border: none; color: var(--brand); cursor: pointer; font-weight: 600; font-size: .8rem; padding: 0 4px; }
        .btn-link:hover { text-decoration: underline; }
      `}</style>
    </section>
  );
};
