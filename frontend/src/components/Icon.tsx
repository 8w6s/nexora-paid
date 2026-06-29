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
  // <img src> cannot inherit `currentColor` from CSS — the SVG would render
  // with its document-root color (which we authored as currentColor → fals
  // back to black). CSS mask-image solves this: the SVG becomes a stencil
  // that gets filled with the element's actual color, so duotone SVGs that
  // baked `currentColor` and `opacity=".5"` keep their two-tone look but
  // pick up the surrounding text colour.
  const url = `/icons-solar/${name}.svg`;
  return (
    <span
      role="img"
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        ...style,
      }}
    />
  );
};