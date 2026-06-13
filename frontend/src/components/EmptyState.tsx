import type React from "react";
import { Icon } from "./Icon";

/**
 * Generic empty-state placeholder used inside admin tables and admin tabs.
 * Centered icon chip + title + description + optional CTA.
 */
export const EmptyState: React.FC<{
  icon?: React.ComponentProps<typeof Icon>["name"];
  title: string;
  desc?: string;
  cta?: React.ReactNode;
  compact?: boolean;
}> = ({ icon = "box", title, desc, cta, compact }) => (
  <div className={`empty-state ${compact ? "compact" : ""}`}>
    <span className="es-icon">
      <Icon name={icon} size={compact ? 20 : 26} variant="badge" />
    </span>
    <h3>{title}</h3>
    {desc && <p>{desc}</p>}
    {cta && <div className="es-cta">{cta}</div>}
    <style>{`
      .empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; text-align: center; color: var(--ink-soft); }
      .empty-state.compact { padding: 28px 18px; gap: 6px; }
      .empty-state h3 { font-size: 1.05rem; font-weight: 700; color: var(--ink); }
      .empty-state.compact h3 { font-size: .92rem; }
      .empty-state p { font-size: .86rem; color: var(--ink-faint); max-width: 360px; line-height: 1.5; }
      .empty-state.compact p { font-size: .8rem; }
      .es-cta { margin-top: 8px; }
    `}</style>
  </div>
);
