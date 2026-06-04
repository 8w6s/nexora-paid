import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useConfig } from "./ConfigContext";
import { Icon } from "./Icon";

interface Stats { sales: number; buyers: number; rating: number; }

// SellAuth-style shop header: big shop name on the left, 3 KPI stats on the right.
// New shops (no data) show a friendly "New store" badge instead of three zeros.
export const StorefrontHeader: React.FC = () => {
  const { config } = useConfig();
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { api.get<Stats>("/api/storefront/stats").then(setS).catch(() => setS({ sales: 0, buyers: 0, rating: 0 })); }, []);

  const empty = s && s.sales === 0 && s.buyers === 0 && s.rating === 0;

  return (
    <header className="sf-head card">
      <h1 className="sf-name">{config.storeName ?? "Nexora"}</h1>
      {s && (empty ? (
        <span className="sf-new"><Icon name="zap" size={13} variant="duotone-regular" /> New store · stats appear after the first sale</span>
      ) : (
        <div className="sf-stats">
          <div className="sf-stat"><strong>{s.sales}</strong><span>Sales</span></div>
          <div className="sf-stat"><strong>{s.buyers}</strong><span>Buyers</span></div>
          <div className="sf-stat"><strong>{s.rating.toFixed(2)}</strong><span>Rating</span></div>
        </div>
      ))}
      <style>{`
        .sf-head { display: flex; align-items: center; justify-content: space-between; padding: 22px 26px; margin-bottom: 18px; gap: 18px; flex-wrap: wrap; }
        .sf-name { font-size: 2rem; font-weight: 700; color: var(--ink); letter-spacing: -.02em; line-height: 1; }
        .sf-stats { display: flex; gap: 36px; padding-left: 26px; border-left: 1px solid var(--line); }
        .sf-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 72px; }
        .sf-stat strong { font-size: 1.8rem; font-weight: 700; color: var(--ink); line-height: 1.1; font-variant-numeric: tabular-nums; }
        .sf-stat span { font-size: .68rem; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .12em; }
        .sf-new { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 100px; background: var(--brand-soft); color: var(--brand); font-size: .8rem; font-weight: 600; }
        @media (max-width: 600px) { .sf-stats { padding-left: 0; border-left: none; gap: 22px; } .sf-name { font-size: 1.5rem; } .sf-stat strong { font-size: 1.4rem; } }
      `}</style>
    </header>
  );
};
