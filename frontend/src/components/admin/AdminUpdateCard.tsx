import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";

interface CheckResp {
  current: string;
  latest: string;
  minSupported: string;
  channel: string;
  updateAvailable: boolean;
  blockedByMin: boolean;
  imageRepo: string;
  imageTag: string;
  sha256: string | null;
  changelogUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  canApply: boolean;
  error?: string;
  code?: string;
}

interface JobResp {
  id: string;
  status:
    | "pending"
    | "snapshotting"
    | "pulling"
    | "swapping"
    | "healthchecking"
    | "ok"
    | "rolled-back"
    | "failed";
  fromVersion: string;
  toVersion: string;
  startedAt: number;
  finishedAt?: number;
  backupPath?: string;
  steps: Array<{ at: number; msg: string }>;
  error?: string;
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export const AdminUpdateCard: React.FC = () => {
  const [info, setInfo] = useState<CheckResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<JobResp | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const r = await api.get<CheckResp>("/api/admin/update/check");
      setInfo(r);
    } catch (e: any) {
      setInfo({
        current: "?",
        latest: "?",
        minSupported: "?",
        channel: "?",
        updateAvailable: false,
        blockedByMin: false,
        imageRepo: "",
        imageTag: "",
        sha256: null,
        changelogUrl: null,
        publishedAt: null,
        notes: null,
        canApply: false,
        error: e?.message ?? "Could not reach update server",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    check();
  }, []);

  const apply = async () => {
    if (!info?.updateAvailable) return;
    setApplying(true);
    setConfirmOpen(false);
    try {
      const j = await api.post<JobResp>("/api/admin/update/apply", {
        expectVersion: info.latest,
      });
      setJob(j);
      pollStatus(j.id);
    } catch (e: any) {
      setJob({
        id: "err",
        status: "failed",
        fromVersion: info.current,
        toVersion: info.latest,
        startedAt: Date.now(),
        steps: [],
        error: e?.message ?? "Apply failed",
      });
    } finally {
      setApplying(false);
    }
  };

  const pollStatus = async (jobId: string) => {
    const terminal = new Set(["ok", "rolled-back", "failed"]);
    for (let i = 0; i < 120; i++) {
      try {
        const j = await api.get<JobResp>(
          `/api/admin/update/status?jobId=${encodeURIComponent(jobId)}`,
        );
        setJob(j);
        if (terminal.has(j.status)) return;
      } catch {
        // backend may briefly 502 during the swap — keep polling
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  if (!info) return null;

  const tone = info.error
    ? "warn"
    : info.blockedByMin
      ? "bad"
      : info.updateAvailable
        ? "warn"
        : "ok";

  return (
    <div className={`upd-card card upd-${tone}`}>
      <div className="upd-head">
        <span className="upd-icon">
          <Icon name="download" size={16} />
        </span>
        <div className="upd-title">
          <strong>Updates</strong>
          <span className="upd-sub">
            {info.error
              ? info.error
              : info.updateAvailable
                ? `New version ${info.latest} available`
                : `Up to date · ${info.current}`}
          </span>
        </div>
        <button
          type="button"
          className="upd-btn upd-btn-ghost"
          onClick={check}
          disabled={loading}
        >
          {loading ? "Checking…" : "Check now"}
        </button>
      </div>

      {info.updateAvailable && !info.error && (
        <div className="upd-meta">
          <div className="upd-row">
            <span className="upd-k">Current</span>
            <span className="upd-v">{info.current}</span>
          </div>
          <div className="upd-row">
            <span className="upd-k">Latest</span>
            <span className="upd-v">
              {info.latest}{" "}
              {info.publishedAt && (
                <span className="upd-faint">· {fmtDate(info.publishedAt)}</span>
              )}
            </span>
          </div>
          <div className="upd-row">
            <span className="upd-k">Channel</span>
            <span className="upd-v">{info.channel}</span>
          </div>
          {info.changelogUrl && (
            <div className="upd-row">
              <span className="upd-k">Notes</span>
              <span className="upd-v">
                <a href={info.changelogUrl} target="_blank" rel="noreferrer">
                  Changelog →
                </a>
              </span>
            </div>
          )}
          <div className="upd-actions">
            {info.canApply ? (
              <button
                type="button"
                className="upd-btn upd-btn-primary"
                onClick={() => setConfirmOpen(true)}
                disabled={applying || (job && job.status !== "ok" && job.status !== "failed" && job.status !== "rolled-back")}
              >
                Apply update
              </button>
            ) : (
              <span className="upd-faint">
                In-place apply unavailable — re-deploy with{" "}
                <code>docker-compose.updater.yml</code> overlay to enable.
              </span>
            )}
          </div>
        </div>
      )}

      {job && (
        <div className="upd-job">
          <div className="upd-row">
            <span className="upd-k">Status</span>
            <span className={`upd-pill upd-pill-${job.status}`}>{job.status}</span>
          </div>
          {job.backupPath && (
            <div className="upd-row">
              <span className="upd-k">Backup</span>
              <span className="upd-v"><code>{job.backupPath}</code></span>
            </div>
          )}
          {job.error && (
            <div className="upd-row">
              <span className="upd-k">Error</span>
              <span className="upd-v upd-err">{job.error}</span>
            </div>
          )}
          <details>
            <summary>Steps ({job.steps.length})</summary>
            <ol className="upd-steps">
              {job.steps.map((s) => (
                <li key={`${s.at}-${s.msg}`}>
                  <span className="upd-faint">
                    {new Date(s.at).toLocaleTimeString()}
                  </span>{" "}
                  {s.msg}
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}

      {confirmOpen && (
        <div className="upd-confirm" role="dialog">
          <div className="upd-confirm-body">
            <strong>Apply update to {info.latest}?</strong>
            <p>
              A backup of the database volume will be taken first. The service
              restarts briefly; existing customer sessions stay intact.
              Automatic rollback if the new version fails its healthcheck.
            </p>
            <div className="upd-confirm-actions">
              <button
                type="button"
                className="upd-btn upd-btn-ghost"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="upd-btn upd-btn-primary"
                onClick={apply}
              >
                Backup & update
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .upd-card { padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
        .upd-head { display: flex; align-items: center; gap: 12px; }
        .upd-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .upd-title { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
        .upd-title strong { font-size: .92rem; color: var(--ink); }
        .upd-sub { font-size: .78rem; color: var(--ink-soft); }
        .upd-meta, .upd-job { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--line); }
        .upd-row { display: flex; gap: 12px; font-size: .82rem; align-items: baseline; }
        .upd-k { width: 86px; color: var(--ink-faint); flex-shrink: 0; }
        .upd-v { color: var(--ink); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .upd-faint { color: var(--ink-faint); font-size: .76rem; }
        .upd-err { color: var(--price); }
        .upd-actions { padding-top: 8px; }
        .upd-btn { font: inherit; font-weight: 600; padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); }
        .upd-btn:disabled { opacity: .5; cursor: not-allowed; }
        .upd-btn-primary { background: var(--brand, #137333); color: white; border-color: transparent; }
        .upd-btn-ghost { background: transparent; }
        .upd-ok .upd-icon { background: var(--auto-soft, #e6f4ea); color: var(--auto, #137333); }
        .upd-warn .upd-icon { background: var(--warn-soft, #fff4e5); color: var(--warn, #b25e00); }
        .upd-bad .upd-icon { background: var(--price-soft); color: var(--price); }
        .upd-pill { padding: 2px 10px; border-radius: 100px; font-size: .72rem; font-weight: 700; }
        .upd-pill-ok { background: var(--auto-soft); color: var(--auto); }
        .upd-pill-failed, .upd-pill-rolled-back { background: var(--price-soft); color: var(--price); }
        .upd-pill-pending, .upd-pill-snapshotting, .upd-pill-pulling, .upd-pill-swapping, .upd-pill-healthchecking { background: var(--warn-soft); color: var(--warn); }
        .upd-steps { margin: 6px 0 0 18px; padding: 0; font-size: .78rem; color: var(--ink-soft); }
        .upd-confirm { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .upd-confirm-body { background: var(--surface); border-radius: 10px; padding: 22px; max-width: 440px; }
        .upd-confirm-body p { color: var(--ink-soft); font-size: .86rem; margin: 8px 0 16px; }
        .upd-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
      `}</style>
    </div>
  );
};