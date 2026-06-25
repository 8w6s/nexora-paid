import type React from "react";
import { useEffect, useRef, useState } from "react";
import { LOCALES, useT } from "../i18n";

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="lang" ref={ref}>
      <button
        type="button"
        className="lang-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={current.label}
      >
        <span aria-hidden="true">{current.flag}</span>
        <span className="lang-code">{current.code.toUpperCase()}</span>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox">
          {LOCALES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === locale}
                className={`lang-item ${l.code === locale ? "on" : ""}`}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .lang { position: relative; display: inline-block; }
        .lang-btn { display: inline-flex; align-items: center; gap: 6px; background: none; border: 1px solid var(--border, #e5e5e5); color: var(--ink); padding: 5px 10px; border-radius: 100px; cursor: pointer; font-size: .82rem; font-weight: 600; }
        .lang-btn:hover { background: var(--surface-2); }
        .lang-code { font-variant: tabular-nums; letter-spacing: .04em; }
        .lang-menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--surface, #fff); border: 1px solid var(--border, #e5e5e5); border-radius: 10px; padding: 4px; list-style: none; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,.12); z-index: 50; }
        .lang-item { width: 100%; display: flex; align-items: center; gap: 8px; background: none; border: none; color: var(--ink); padding: 7px 10px; border-radius: 7px; cursor: pointer; font-size: .85rem; text-align: left; }
        .lang-item:hover { background: var(--surface-2); }
        .lang-item.on { color: var(--brand); font-weight: 700; }
      `}</style>
    </div>
  );
};
