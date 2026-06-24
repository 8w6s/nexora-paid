import { RGBA } from "@opentui/core";

// Palette — sao chép từ MiMoCode dark theme, đổi accent thành identity Nexora.
export const theme = {
  background: RGBA.fromInts(8, 8, 10, 255),
  panel: RGBA.fromInts(14, 14, 18, 255),
  border: RGBA.fromInts(40, 40, 50, 255),
  text: RGBA.fromInts(220, 220, 220, 255),
  textDim: RGBA.fromInts(140, 140, 140, 255),
  textMuted: RGBA.fromInts(80, 80, 90, 255),
  primary: RGBA.fromInts(251, 129, 71, 255),
  primaryDim: RGBA.fromInts(180, 90, 50, 255),
  accent: RGBA.fromInts(160, 160, 160, 255),
  star: RGBA.fromInts(237, 220, 170, 255),
  starHot: RGBA.fromInts(255, 255, 255, 255),
  ok: RGBA.fromInts(80, 220, 130, 255),
  warn: RGBA.fromInts(245, 200, 80, 255),
  err: RGBA.fromInts(240, 80, 100, 255),
  off: RGBA.fromInts(90, 90, 100, 255),
};

export type Theme = typeof theme;

// tint() copy nguyên xi từ MiMoCode (context/theme.tsx).
export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha;
  const g = base.g + (overlay.g - base.g) * alpha;
  const b = base.b + (overlay.b - base.b) * alpha;
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}
