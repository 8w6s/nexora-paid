import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface DropdownOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ComponentProps<typeof Icon>["name"];
  desc?: string;
  disabled?: boolean;
}

/**
 * Pretty replacement for <select>. Opens a popup of options with icons,
 * keyboard navigation (Up/Down/Enter/Esc, Home/End), click-outside close,
 * and a smooth pop-in animation. Falls back gracefully on focus loss.
 */
export function Dropdown<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  width,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: DropdownOption<T>[];
  placeholder?: string;
  width?: number | string;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number>(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isKeyNavRef = useRef(false);

  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, options, value]);

  // Scroll the active item into view.
  useEffect(() => {
    if (!open || !listRef.current || !isKeyNavRef.current) return;
    const el = listRef.current.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = (delta: number) => {
    const n = options.length;
    if (n === 0) return;
    let i = active;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      isKeyNavRef.current = true;
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      isKeyNavRef.current = true;
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      isKeyNavRef.current = true;
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      isKeyNavRef.current = true;
      setActive(options.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const styleW: React.CSSProperties = width
    ? { width: typeof width === "number" ? `${width}px` : width }
    : {};

  return (
    <div
      ref={rootRef}
      className={`dd ${size} ${open ? "open" : ""} ${className ?? ""}`}
      style={styleW}
      onKeyDown={onKey}
    >
      <button
        type="button"
        className="dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dd-value">
          {current?.icon && <Icon name={current.icon} size={14} variant="duotone-regular" />}
          <span className="dd-label">{current?.label ?? placeholder ?? "Select…"}</span>
        </span>
        <Icon name="arrow-right" size={13} className="dd-caret" />
      </button>

      {open && (
        <ul ref={listRef} id={`${id}-list`} className="dd-list" tabIndex={-1}>
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              aria-selected={value === o.value}
              aria-disabled={o.disabled || undefined}
              className={`dd-opt ${i === active ? "active" : ""} ${value === o.value ? "selected" : ""} ${o.disabled ? "disabled" : ""}`}
              onMouseEnter={() => {
                if (!o.disabled) {
                  isKeyNavRef.current = false;
                  setActive(i);
                }
              }}
              onClick={() => choose(i)}
            >
              {o.icon && (
                <span className="dd-opt-icon">
                  <Icon name={o.icon} size={14} variant="duotone-regular" />
                </span>
              )}
              <span className="dd-opt-text">
                <span className="dd-opt-label">{o.label}</span>
                {o.desc && <span className="dd-opt-desc">{o.desc}</span>}
              </span>
              {value === o.value && <Icon name="check" size={14} className="dd-tick" />}
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .dd { position: relative; display: inline-block; font-family: var(--font-sans); }
        .dd-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 44px; padding: 0 14px 0 16px; border: 1px solid var(--line-strong); border-radius: 100px; background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-weight: 600; font-size: .88rem; cursor: pointer; transition: border-color .15s var(--ease), box-shadow .15s var(--ease); }
        .dd.sm .dd-trigger { min-height: 36px; padding: 0 12px 0 14px; font-size: .82rem; }
        .dd-trigger:hover { border-color: var(--brand); }
        .dd.open .dd-trigger { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
        .dd-value { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
        .dd-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dd-caret { color: var(--ink-faint); transform: rotate(90deg); transition: transform .18s var(--ease); }
        .dd.open .dd-caret { transform: rotate(-90deg); color: var(--brand); }
        .dd-list { position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 100%; background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius); box-shadow: var(--shadow-hover); padding: 6px; z-index: 100; max-height: 320px; overflow-y: auto; list-style: none; display: flex; flex-direction: column; gap: 2px; animation: dd-pop .14s cubic-bezier(.16,1,.3,1) both; }
        .dd-opt { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: .86rem; color: var(--ink); }
        .dd-opt.active { background: var(--brand-soft); color: var(--brand); }
        .dd-opt.selected:not(.active) { background: var(--surface-2); }
        .dd-opt.disabled { opacity: .45; cursor: not-allowed; }
        .dd-opt-icon { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: var(--surface-2); color: var(--ink-soft); flex-shrink: 0; }
        .dd-opt.active .dd-opt-icon { background: color-mix(in srgb, var(--brand) 18%, transparent); color: var(--brand); }
        .dd-opt-text { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .dd-opt-label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dd-opt-desc { font-size: .76rem; color: var(--ink-faint); font-weight: 400; }
        .dd-tick { color: var(--brand); }
        @keyframes dd-pop { from { opacity: 0; transform: translateY(-4px) scale(.985); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .dd-list { animation: none; } .dd-caret { transition: none; } }
      `}</style>
    </div>
  );
}
