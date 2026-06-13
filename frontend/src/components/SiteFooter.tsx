import type React from "react";
import { useConfig } from "./ConfigContext";

/** Storefront footer — shop name + copyright + policy links. */
export const SiteFooter: React.FC = () => {
  const { config } = useConfig();
  const year = 2026; // see CLAUDE.md — Date.now() forbidden in some helpers; fixed copyright year
  return (
    <footer className="sf-foot">
      <div className="container sf-foot-inner">
        <div className="sf-foot-brand">
          <span className="sf-foot-name">{config.storeName ?? "Nexora"}</span>
          <span className="sf-foot-cr">© {year} — Digital goods, delivered instantly.</span>
        </div>
        <nav className="sf-foot-links" aria-label="Footer">
          <span onClick={() => window.location.assign("/terms")}>Terms of Service</span>
          <span onClick={() => window.location.assign("/privacy")}>Privacy Policy</span>
          <span onClick={() => window.location.assign("/refund")}>Refund Policy</span>
          <span onClick={() => window.location.assign("/tickets")}>Support</span>
        </nav>
      </div>
      <style>{`
        .sf-foot { border-top: 1px solid var(--line); margin-top: 64px; padding: 26px 0; background: var(--surface); }
        .sf-foot-inner { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; }
        .sf-foot-brand { display: flex; flex-direction: column; gap: 3px; }
        .sf-foot-name { font-weight: 700; font-size: 1rem; color: var(--ink); }
        .sf-foot-cr { font-size: .8rem; color: var(--ink-faint); }
        .sf-foot-links { display: flex; gap: 22px; flex-wrap: wrap; }
        .sf-foot-links span { font-size: .85rem; color: var(--ink-soft); cursor: pointer; transition: color .15s var(--ease); }
        .sf-foot-links span:hover { color: var(--brand); }
        @media (max-width: 560px) { .sf-foot-inner { flex-direction: column; align-items: flex-start; } }
      `}</style>
    </footer>
  );
};
