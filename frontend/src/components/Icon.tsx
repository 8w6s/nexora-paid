import type React from "react";

type IconName =
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
  | "link";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Inline style passthrough — callers occasionally need to nudge color/opacity per-instance. */
  style?: React.CSSProperties;
  /** FA visual style. */
  variant?: "duotone" | "regular" | "duotone-regular" | "badge";
}

const paths: Record<IconName, React.ReactNode> = {
  cart: (
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  spinner: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  box: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  home: (
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  "arrow-right": <path d="M5 12h14M12 5l7 7-7 7" />,
  "arrow-left": <path d="M19 12H5M12 19l-7-7 7-7" />,
  "arrow-up": <path d="M12 19V5M5 12l7-7 7 7" />,
  package: (
    <>
      <path d="M16.5 9.4 7.5 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />,
  truck: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1" />
      <circle cx="7.5" cy="18.5" r="2.5" />
      <circle cx="17.5" cy="18.5" r="2.5" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3M16 7l3 3M19 4l2 2" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  star: (
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
  ),
  ticket: (
    <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4 2 2 0 0 1 2-2 2 2 0 0 0 0-4z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  pencil: (
    <>
      <path d="M3 21l3.75-.75L20.5 6.5l-3-3L3.75 17.25 3 21z" />
      <path d="M15 5.5l3 3" />
      <path d="M5 19l-1 1" />
    </>
  ),
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  menu: (
    <>
      <path d="M3 12h18" />
      <path d="M3 6h18" />
      <path d="M3 18h18" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  tag: (
    <>
      <path d="m12 5 9 9a2 2 0 0 1 0 2.83l-7.17 7.17a2 2 0 0 1-2.83 0l-9-9V5a2 2 0 0 1 2-2h5Z" />
      <circle cx="9.5" cy="9.5" r="1.5" fill="currentColor" />
    </>
  ),
  "credit-card": (
    <>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  envelope: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

// Map our icon names → Font Awesome icon names (used when a FA Pro Kit is loaded).
const faName: Record<IconName, string> = {
  cart: "cart-shopping",
  search: "magnifying-glass",
  plus: "plus",
  minus: "minus",
  trash: "trash",
  close: "xmark",
  check: "circle-check",
  spinner: "spinner-third",
  box: "box-taped",
  receipt: "receipt",
  home: "house",
  "arrow-right": "arrow-right",
  "arrow-left": "arrow-left",
  "arrow-up": "arrow-up",
  package: "box-open",
  shield: "shield-check",
  truck: "truck",
  key: "key",
  mail: "envelope",
  bell: "bell",
  copy: "copy",
  zap: "bolt",
  bolt: "bolt",
  star: "star",
  ticket: "ticket",
  sun: "sun",
  moon: "moon",
  pencil: "pencil",
  folder: "folder",
  menu: "bars",
  users: "users",
  tag: "tag",
  "credit-card": "credit-card",
  activity: "chart-line",
  settings: "gear",
  globe: "globe",
  envelope: "envelope",
  link: "link",
};

export const Icon: React.FC<IconProps> = ({
  name,
  size = 20,
  className,
  style,
  variant = "duotone-regular",
}) => {
  const _svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );

  // We are using CSS Webfonts mode, which means we can directly render the <i> tag.
  // Font Awesome will render via CSS :before selector without modifying the DOM node itself,
  // resolving Hydration Mismatch completely.
  const spin = name === "spinner" ? " fa-spin" : "";
  const styleClass =
    variant === "regular"
      ? "fa-regular"
      : variant === "duotone-regular" || variant === "badge"
        ? "fa-duotone fa-regular"
        : "fa-duotone";
  const iconEl = (
    <i
      className={`${styleClass} fa-${faName[name]}${spin} ${variant === "badge" ? "" : (className ?? "")}`}
      style={{ fontSize: size, lineHeight: 1, ...style }}
      aria-hidden="true"
    />
  );

  if (variant === "badge") {
    return (
      <span
        className={`icon-badge ${className ?? ""}`}
        style={{ width: size * 2, height: size * 2 }}
        aria-hidden="true"
      >
        {iconEl}
        <BadgeStyles />
      </span>
    );
  }
  return iconEl;
};

// Round tinted chip wrapping an icon (app-like badge style).
const BadgeStyles: React.FC = () => (
  <style>{`
    .icon-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
      background: var(--brand-soft, rgba(79,70,229,.12)); color: var(--brand, #4f46e5); flex-shrink: 0; }
  `}</style>
);
