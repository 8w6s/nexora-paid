/**
 * Inline SVG flags for the language switcher.
 *
 * Windows + Chrome doesn't ship Twemoji or any colour flag font, so
 * 🇬🇧/🇻🇳/etc. fall back to the literal regional-indicator leters
 * ("GB", "VN", ...). Inline SVG renders identically on every OS / browser
 * and adds <2 KB to the bundle for the 5 locales we support.
 *
 * Sources: simplified from the public-domain Wikipedia SVG flags.
 */
import type React from "react";
import type { Locale } from "../i18n";

type Props = {
  code: Locale;
  size?: number;
  className?: string;
  title?: string;
};

const COMMON = { rx: 2, role: "img" as const };

function Flag({
  code,
  size = 18,
  className,
  title,
  children,
}: Props & { children: React.ReactNode }) {
  const h = Math.round(size * 0.7);
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 30 20"
      className={className}
      {...COMMON}
      aria-label={title ?? code}
    >
      {title ? <title>{title}</title> : null}
      <clipPath id={`fl-${code}`}>
        <rect width="30" height="20" rx="2" ry="2" />
      </clipPath>
      <g clipPath={`url(#fl-${code})`}>{children}</g>
    </svg>
  );
}

export const FlagIcon: React.FC<Props> = ({ code, size, className, title }) => {
  switch (code) {
    case "en":
      // Union Jack — simplified.
      return (
        <Flag code={code} size={size} className={className} title={title}>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" strokeWidth="3" />
          <path
            d="M0,0 L30,20 M30,0 L0,20"
            stroke="#C8102E"
            strokeWidth="1.5"
            clipPath="inset(0 50% 0 0)"
          />
          <path d="M15,0 V20 M0,10 H30" stroke="#fff" strokeWidth="5" />
          <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth="3" />
        </Flag>
      );
    case "vi":
      // Yellow star on red.
      return (
        <Flag code={code} size={size} className={className} title={title}>
          <rect width="30" height="20" fill="#DA251D" />
          <path
            d="M15 4 L16.76 9.42 H22.45 L17.85 12.77 L19.61 18.18 L15 14.83 L10.39 18.18 L12.15 12.77 L7.55 9.42 H13.24 Z"
            fill="#FFFF00"
          />
        </Flag>
      );
    case "zh":
      // Red with 1 large + 4 small stars (simplified, single star big).
      return (
        <Flag code={code} size={size} className={className} title={title}>
          <rect width="30" height="20" fill="#DE2910" />
          <g fill="#FFDE00">
            <path d="M6 3.5 L6.94 6.39 H9.98 L7.52 8.18 L8.46 11.07 L6 9.28 L3.54 11.07 L4.48 8.18 L2.02 6.39 H5.06 Z" />
            <circle cx="11.5" cy="2.2" r="0.55" />
            <circle cx="13.2" cy="4.2" r="0.55" />
            <circle cx="13.2" cy="6.8" r="0.55" />
            <circle cx="11.5" cy="8.6" r="0.55" />
          </g>
        </Flag>
      );
    case "es":
      // 3 horizontal stripes: red/yellow (2x)/red.
      return (
        <Flag code={code} size={size} className={className} title={title}>
          <rect width="30" height="20" fill="#AA151B" />
          <rect y="5" width="30" height="10" fill="#F1BF00" />
        </Flag>
      );
    case "de":
      // 3 horizontal stripes: black/red/gold.
      return (
        <Flag code={code} size={size} className={className} title={title}>
          <rect width="30" height="6.67" fill="#000" />
          <rect y="6.67" width="30" height="6.67" fill="#DD0000" />
          <rect y="13.33" width="30" height="6.67" fill="#FFCE00" />
        </Flag>
      );
    default:
      return null;
  }
};