import type React from "react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { Icon } from "./Icon";

interface ReviewItem {
  id: string;
  rating: number;
  body: string;
  email: string;
  createdAt: number;
}
interface ReviewsResp {
  enabled: boolean;
  average: number;
  count: number;
  reviews: ReviewItem[];
}
interface CanReview {
  canReview: boolean;
  reason?: string;
}

const Stars: React.FC<{ value: number; size?: number; onPick?: (n: number) => void }> = ({
  value,
  size = 16,
  onPick,
}) => (
  <span className="stars" role={onPick ? "radiogroup" : undefined}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        className={`star ${n <= value ? "on" : ""} ${onPick ? "pick" : ""}`}
        onClick={onPick ? () => onPick(n) : undefined}
        disabled={!onPick}
        aria-label={onPick ? `${n} star${n > 1 ? "s" : ""}` : undefined}
      >
        <Icon name="star" size={size} variant={n <= value ? "duotone" : "regular"} />
      </button>
    ))}
  </span>
);

export const ProductReviews: React.FC<{ slug: string }> = ({ slug }) => {
  const { t } = useT();
  const [data, setData] = useState<ReviewsResp | null>(null);
  const [can, setCan] = useState<CanReview | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api
      .get<ReviewsResp>(`/api/products/${slug}/reviews`)
      .then(setData)
      .catch(() => setData(null));
    api
      .get<CanReview>(`/api/products/${slug}/can-review`)
      .then(setCan)
      .catch(() => setCan({ canReview: false }));
  };
  useEffect(load, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/api/products/${slug}/reviews`, { rating, body: body.trim() || undefined });
      setBody("");
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  };

  if (!data?.enabled) return null;

  return (
    <section className="reviews">
      <div className="rv-head">
        <h2>{t("storefront.product.reviewsTitle")}</h2>
        {data.count > 0 && (
          <div className="rv-agg">
            <Stars value={Math.round(data.average)} size={18} />
            <strong>{data.average.toFixed(1)}</strong>
            <span>
              ({data.count} review{data.count !== 1 ? "s" : ""})
            </span>
          </div>
        )}
      </div>

      {can?.canReview && (
        <form method="post" className="rv-form" onSubmit={submit}>
          <div className="rv-form-row">
            <span>Your rating</span>
            <Stars value={rating} size={22} onPick={setRating} />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your experience (optional)"
            rows={3}
            maxLength={1000}
          />
          {err && <div className="rv-err">{err}</div>}
          <button className="btn" disabled={busy} type="submit">
            {busy ? (
              <>
                <Icon name="spinner" size={15} className="is-spinning" /> Submitting…
              </>
            ) : (
              "Submit review"
            )}
          </button>
        </form>
      )}
      {can && !can.canReview && can.reason === "not-purchased" && (
        <p className="rv-note">
          <Icon name="box" size={14} /> {t("storefront.product.verifiedOnly")}
        </p>
      )}
      {can && !can.canReview && can.reason === "already-reviewed" && (
        <p className="rv-note">
          <Icon name="zap" size={14} /> Thanks — you've already reviewed this product.
        </p>
      )}

      {data.count === 0 ? (
        <p className="rv-empty">{t("storefront.product.noReviews")}</p>
      ) : (
        <ul className="rv-list">
          {data.reviews.map((r) => (
            <li key={r.id} className="rv-item">
              <div className="rv-item-top">
                <Stars value={r.rating} size={14} />
                <span className="rv-email">{r.email}</span>
                <span className="rv-date">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              {r.body && <p className="rv-body">{r.body}</p>}
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .reviews { margin-top: 56px; }
        .rv-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
        .rv-head h2 { font-size: 1.3rem; }
        .rv-agg { display: flex; align-items: center; gap: 8px; font-size: .9rem; color: var(--ink-soft); }
        .rv-agg strong { color: var(--ink); font-size: 1.05rem; }
        .stars { display: inline-flex; gap: 2px; }
        .star { background: none; border: none; padding: 0; display: inline-flex; color: var(--line-strong); cursor: default; }
        .star.on { color: #f5a623; }
        .star.pick { cursor: pointer; }
        .rv-form { display: flex; flex-direction: column; gap: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 22px; }
        .rv-form-row { display: flex; align-items: center; gap: 12px; font-size: .88rem; font-weight: 600; color: var(--ink-soft); }
        .rv-form textarea { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 10px 12px; font-family: var(--font-sans); font-size: .9rem; resize: vertical; color: var(--ink); background: var(--surface-2); outline: none; }
        .rv-form textarea:focus { border-color: var(--brand); }
        .rv-form .btn { align-self: flex-start; }
        .rv-err { color: var(--err,#c0392b); font-size: .82rem; }
        .rv-note { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; color: var(--ink-faint); margin-bottom: 18px; }
        .rv-empty { color: var(--ink-faint); font-size: .9rem; padding: 14px 0; }
        .rv-list { display: flex; flex-direction: column; gap: 14px; list-style: none; }
        .rv-item { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; background: var(--surface); }
        .rv-item-top { display: flex; align-items: center; gap: 10px; font-size: .8rem; color: var(--ink-faint); }
        .rv-email { font-weight: 600; color: var(--ink-soft); }
        .rv-date { margin-left: auto; }
        .rv-body { margin-top: 8px; font-size: .9rem; line-height: 1.6; color: var(--ink-soft); }
      `}</style>
    </section>
  );
};
