import type React from "react";

// Base shimmer block. Compose these into skeletons that mirror the real layout.
export const Sk: React.FC<{
  w?: string | number;
  h?: string | number;
  r?: number;
  style?: React.CSSProperties;
  className?: string;
}> = ({ w = "100%", h = 14, r = 6, style, className }) => (
  <span
    className={`sk ${className ?? ""}`}
    style={{ width: w, height: h, borderRadius: r, ...style }}
    aria-hidden="true"
  />
);

// One product card placeholder, matching ProductCard's structure.
export const SkProductCard: React.FC = () => (
  <div className="sk-card" aria-hidden="true">
    <Sk h={0} style={{ aspectRatio: "16 / 9", height: "auto", width: "100%", borderRadius: 0 }} />
    <div className="sk-card-body">
      <Sk w={60} h={18} r={100} />
      <Sk w="85%" h={16} />
      <Sk w="100%" h={11} />
      <Sk w="70%" h={11} />
      <div className="sk-card-foot">
        <Sk w={70} h={22} />
        <Sk w={90} h={34} r={8} />
      </div>
    </div>
  </div>
);

// A grid of product card skeletons (matches ProductList grid).
export const SkProductGrid: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="sk-grid" role="status" aria-label="Loading products">
    {Array.from({ length: count }).map((_, i) => (
      <SkProductCard key={i} />
    ))}
  </div>
);

// Generic stacked rows (orders lists, etc.)
export const SkRows: React.FC<{ count?: number; height?: number }> = ({
  count = 4,
  height = 64,
}) => (
  <div className="sk-rows" role="status" aria-label="Loading">
    {Array.from({ length: count }).map((_, i) => (
      <Sk key={i} h={height} r={12} />
    ))}
  </div>
);

// Shared shimmer CSS — mount once per page (it's deduped by being identical).
export const SkeletonStyles: React.FC = () => (
  <style>{`
    .sk { display: block; position: relative; overflow: hidden; background: var(--surface-2, #eef1f4); }
    .sk::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, var(--sk-shimmer, rgba(255,255,255,.65)), transparent);
      animation: sk-shimmer 1.25s infinite; }
    [data-theme="dark"] .sk::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent); }
    @keyframes sk-shimmer { 100% { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .sk::after { animation: none; } }
    .sk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
    .sk-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
    .sk-card-body { padding: 14px 15px 16px; display: flex; flex-direction: column; gap: 9px; }
    .sk-card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--line); }
    .sk-rows { display: flex; flex-direction: column; gap: 12px; }
  `}</style>
);
