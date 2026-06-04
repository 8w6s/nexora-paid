import React from "react";

/**
 * Animated checkbox — the box outline morphs into a checkmark via SVG stroke-dasharray.
 * Technique adapted from a Uiverse.io component (SelfMadeSystem, MIT). Rewritten as a
 * controlled React component themed to the shop's brand color.
 */
export const Checkbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  size?: number;
}> = ({ checked, onChange, label, size = 26 }) => (
  <label className="cbx">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <svg viewBox="0 0 64 64" height={size} width={size} aria-hidden="true">
      <path
        key={checked ? "on" : "off"}
        className={`cbx-path ${checked ? "is-checked" : ""}`}
        pathLength={575.0541}
        d="M 0 16 V 56 A 8 8 90 0 0 8 64 H 56 A 8 8 90 0 0 64 56 V 8 A 8 8 90 0 0 56 0 H 8 A 8 8 90 0 0 0 8 V 16 L 32 48 L 64 16 V 8 A 8 8 90 0 0 56 0 H 8 A 8 8 90 0 0 0 8 V 56 A 8 8 90 0 0 8 64 H 56 A 8 8 90 0 0 64 56 V 16"
      />
    </svg>
    {label && <span className="cbx-label">{label}</span>}
    <style>{`
      .cbx { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
      .cbx input { display: none; }
      .cbx svg { overflow: visible; flex-shrink: 0; }
      .cbx-path {
        fill: none; stroke: var(--brand, #4f46e5); stroke-width: 6;
        stroke-linecap: round; stroke-linejoin: round;
        /* Browsers can't interpolate the two numbers of stroke-dasharray simultaneously,
           so we drive the morph from a keyframe instead of a transition. */
        stroke-dasharray: 241 9999999; stroke-dashoffset: 0;
        animation: cbx-uncheck .5s ease forwards;
      }
      .cbx-path.is-checked {
        animation: cbx-check .5s ease forwards;
      }
      @keyframes cbx-check {
        from { stroke-dasharray: 241 9999999; stroke-dashoffset: 0; }
        to   { stroke-dasharray: 70.5097 9999999; stroke-dashoffset: -262.2723; }
      }
      @keyframes cbx-uncheck {
        from { stroke-dasharray: 70.5097 9999999; stroke-dashoffset: -262.2723; }
        to   { stroke-dasharray: 241 9999999; stroke-dashoffset: 0; }
      }
      .cbx-label { font-size: .9rem; font-weight: 500; color: var(--ink, #1f2329); }
    `}</style>
  </label>
);
