import React from "react";

/**
 * Tiny on/off switch (40x22). For settings toggles / feature flags.
 * For the BIG theme switch with sun/moon use <ThemeSwitch/>; this is the plain
 * version used wherever the previous code had its own .xx-switch CSS.
 */
export const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}> = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`tgs ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
  >
    <span className="knob" />
    <style>{`
      .tgs { flex-shrink: 0; width: 40px; height: 22px; border-radius: 100px; background: var(--line-strong); position: relative; border: none; cursor: pointer; transition: background .18s var(--ease); padding: 0; }
      .tgs.on { background: var(--brand); }
      .tgs.disabled { opacity: .5; cursor: not-allowed; }
      .tgs .knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .18s var(--ease); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
      .tgs.on .knob { left: 20px; }
    `}</style>
  </button>
);
