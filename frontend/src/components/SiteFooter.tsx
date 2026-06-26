import type React from "react";
import { useT } from "../i18n";
import { useConfig } from "./ConfigContext";

export const SiteFooter: React.FC = () => {
  const { config } = useConfig();
  const { t } = useT();
  const year = new Date().getFullYear();
  const social = config.social;
  const hasSocial =
    social?.discord || social?.telegram || social?.youtube || social?.tiktok || social?.instagram;

  return (
    <footer className="sf-foot">
      <div className="container sf-foot-inner">
        <div className="sf-foot-brand">
          <span className="sf-foot-name">{config.storeName ?? "Nexora"}</span>
          <span className="sf-foot-cr">
            © {year} — {t("storefront.footer.tagline")}
          </span>
        </div>
        <nav className="sf-foot-links" aria-label={t("storefront.footer.ariaLabel")}>
          <a href="/terms">{t("storefront.footer.terms")}</a>
          <a href="/privacy">{t("storefront.footer.privacy")}</a>
          <a href="/refund">{t("storefront.footer.refund")}</a>
          <a href="/tickets">{t("storefront.footer.support")}</a>
        </nav>
        {hasSocial && (
          <div className="sf-foot-social">
            {social.discord && (
              <a href={social.discord} target="_blank" rel="noopener noreferrer">Discord</a>
            )}
            {social.telegram && (
              <a href={social.telegram} target="_blank" rel="noopener noreferrer">Telegram</a>
            )}
            {social.youtube && (
              <a href={social.youtube} target="_blank" rel="noopener noreferrer">YouTube</a>
            )}
            {social.tiktok && (
              <a href={social.tiktok} target="_blank" rel="noopener noreferrer">TikTok</a>
            )}
            {social.instagram && (
              <a href={social.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>
            )}
          </div>
        )}
      </div>
      <style>{`
        .sf-foot { border-top: 1px solid var(--line); margin-top: 64px; padding: 26px 0; background: var(--surface); }
        .sf-foot-inner { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; }
        .sf-foot-brand { display: flex; flex-direction: column; gap: 3px; }
        .sf-foot-name { font-weight: 700; font-size: 1rem; color: var(--ink); }
        .sf-foot-cr { font-size: .8rem; color: var(--ink-faint); }
        .sf-foot-links { display: flex; gap: 22px; flex-wrap: wrap; }
        .sf-foot-links a { font-size: .85rem; color: var(--ink-soft); text-decoration: none; transition: color .15s var(--ease); }
        .sf-foot-links a:hover { color: var(--brand); }
        .sf-foot-social { display: flex; gap: 16px; flex-wrap: wrap; }
        .sf-foot-social a { font-size: .82rem; color: var(--ink-soft); text-decoration: none; font-weight: 500; transition: color .15s var(--ease); }
        .sf-foot-social a:hover { color: var(--brand); }
        @media (max-width: 560px) { .sf-foot-inner { flex-direction: column; align-items: flex-start; } }
      `}</style>
    </footer>
  );
};