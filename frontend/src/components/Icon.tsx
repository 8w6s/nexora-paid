/**
 * Icon component — renders Solar Duotone SVGs from /icons-solar/*.svg.
 *
 * The SVGs are served as static assets from `frontend/public/icons-solar/`.
 * Each one is `width=height=1em` + `fill=currentColor`, so callers can
 * size with the `size` prop (px) and colour by inheriting CSS `color`.
 *
 * Source: Solar Duotone Icons (getillustrations.com).
 * Licence: Commercial + Personal use license (bundled with the asset pack).
 */
import type React from "react";

export type IconName =
  | "cart"
  | "search"
  | "plus"
  | "minus"
  | "trash"
  | "close"
  | "check"
  | "spinner"
  | "box"
  | "receipt"
  | "home"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up"
  | "package"
  | "shield"
  | "truck"
  | "key"
  | "mail"
  | "bell"
  | "copy"
  | "zap"
  | "bolt"
  | "star"
  | "ticket"
  | "sun"
  | "moon"
  | "pencil"
  | "folder"
  | "menu"
  | "users"
  | "tag"
  | "credit-card"
  | "activity"
  | "settings"
  | "globe"
  | "envelope"
  | "link"
  | "database"
  | "table"
  | "alert-triangle"
  | "download";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Kept for back-compat; ignored. The SVG itself is duotone. */
  variant?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 18, className, style }) => {
  return (
    <img
      src={`/icons-solar/${name}.svg`}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        // currentColor is baked into the SVG; let the surrounding text colour
        // drive it via CSS filter / mask is overkill — `<img>` already renders
        // the duotone fills correctly without inheriting `color`. Callers who
        // need recolour can pass style.filter.
        ...style,
      }}
      aria-hidden="true"
      draggable={false}
    />
  );
};