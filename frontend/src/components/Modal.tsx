import type React from "react";
import { useEffect } from "react";
import { Icon } from "./Icon";

/**
 * Centered modal dialog with backdrop, close X, Esc handler, click-outside.
 * - `open` controls visibility (caller owns the state)
 * - `onClose` fires on Esc, backdrop click, and X button
 * - `size`: sm (420px) / md (560px, default) / lg (720px)
 */
export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  footer?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ open, onClose, title, size = "md", footer, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW = size === "sm" ? 420 : size === "lg" ? 720 : 560;

  return (
    <div className="m-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="m-box card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: maxW }}>
        <button className="m-x" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
        {title && <h3 className="m-title">{title}</h3>}
        <div className="m-body">{children}</div>
        {footer && <div className="m-footer">{footer}</div>}
      </div>
      <style>{`
        .m-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: m-fade .14s ease both; }
        .m-box { position: relative; width: 100%; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; max-height: 90vh; overflow-y: auto; animation: m-pop .22s cubic-bezier(.16,1,.3,1) both; }
        .m-x { position: absolute; top: 12px; right: 12px; background: var(--surface-2); border: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--ink-soft); }
        .m-x:hover { background: var(--line-strong); color: var(--ink); }
        .m-title { font-size: 1.1rem; font-weight: 700; color: var(--ink); padding-right: 36px; }
        .m-body { display: flex; flex-direction: column; gap: 12px; }
        .m-footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px; }
        @keyframes m-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes m-pop { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
};
