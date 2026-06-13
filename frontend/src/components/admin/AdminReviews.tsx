import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { Sk, SkeletonStyles } from "../Skeleton";

interface AdminReview {
  id: string;
  rating: number;
  body: string;
  email: string;
  hidden: boolean;
  createdAt: number;
  productId: string;
  productName: string | null;
}

export const AdminReviews: React.FC = () => {
  const [list, setList] = useState<AdminReview[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api
      .get<AdminReview[]>("/api/admin/reviews")
      .then(setList)
      .catch(() => {});
  useEffect(() => {
    load();
  }, [load]);

  const toggleHidden = async (r: AdminReview) => {
    setBusy(r.id);
    try {
      await api.put(`/api/admin/reviews/${r.id}/hidden`, { hidden: !r.hidden });
      setList(
        (prev) => prev?.map((x) => (x.id === r.id ? { ...x, hidden: !r.hidden } : x)) ?? null,
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: AdminReview) => {
    setBusy(r.id);
    try {
      await api.del(`/api/admin/reviews/${r.id}`);
      setList((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rvm">
      <SkeletonStyles />
      <p className="intro">
        Verified-purchase reviews. Hide abusive ones (kept but not shown on the storefront) or
        delete permanently.
      </p>
      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Rating</th>
                <th>Review</th>
                <th>By</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!list ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Sk w={120} h={13} />
                    </td>
                    <td>
                      <Sk w={70} h={13} />
                    </td>
                    <td>
                      <Sk w={200} h={13} />
                    </td>
                    <td>
                      <Sk w={90} h={13} />
                    </td>
                    <td>
                      <Sk w={56} h={20} r={100} />
                    </td>
                    <td>
                      <Sk w={80} h={13} />
                    </td>
                  </tr>
                ))
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No reviews yet.
                  </td>
                </tr>
              ) : (
                list.map((r) => (
                  <tr key={r.id} className={r.hidden ? "hidden-row" : ""}>
                    <td className="prod">{r.productName ?? "—"}</td>
                    <td className="stars">
                      {"★".repeat(r.rating)}
                      <span className="dim">{"★".repeat(5 - r.rating)}</span>
                    </td>
                    <td className="body">{r.body || <span className="muted">(no text)</span>}</td>
                    <td className="muted sm">{r.email}</td>
                    <td>
                      <span className={`badge ${r.hidden ? "hidden" : "visible"}`}>
                        {r.hidden ? "Hidden" : "Visible"}
                      </span>
                    </td>
                    <td className="actions">
                      <button
                        className="lnk"
                        disabled={busy === r.id}
                        onClick={() => toggleHidden(r)}
                      >
                        {r.hidden ? "Unhide" : "Hide"}
                      </button>
                      <button
                        className="lnk del"
                        disabled={busy === r.id}
                        onClick={() => remove(r)}
                        aria-label="Delete review"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`
        .rvm .intro { color: var(--ink-soft); font-size: .88rem; margin-bottom: 14px; }
        .table-card { padding: 0; overflow: hidden; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
        th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); background: var(--surface-2); }
        .prod { font-weight: 600; font-size: .86rem; }
        .stars { color: #f5a623; white-space: nowrap; }
        .stars .dim { color: var(--line-strong); }
        .body { font-size: .86rem; color: var(--ink-soft); max-width: 320px; }
        .muted { color: var(--ink-soft); } .sm { font-size: .8rem; }
        tr.hidden-row { opacity: .5; }
        .empty { text-align: center; color: var(--ink-faint); padding: 40px; }
        .badge { padding: 4px 11px; border-radius: 100px; font-size: .72rem; font-weight: 600; white-space: nowrap; }
        .badge.visible { color: var(--auto,#137333); background: var(--auto-soft,#e6f4ea); }
        .badge.hidden { color: var(--ink-faint); background: var(--surface-2); }
        .actions { display: flex; gap: 12px; align-items: center; white-space: nowrap; }
        .lnk { background: none; border: none; color: var(--brand); cursor: pointer; font-weight: 600; font-size: .82rem; display: inline-flex; align-items: center; }
        .lnk.del { color: var(--price); }
        .lnk:disabled { opacity: .5; }
      `}</style>
    </div>
  );
};
