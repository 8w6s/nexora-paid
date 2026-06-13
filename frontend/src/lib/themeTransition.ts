/**
 * Theme transition: Drives a gorgeous Ripple/Radial reveal transition
 * with a hardware-accelerated Sandstorm Ripple boundary.
 */
let inFlight = false;
let clickCoords = { x: 0, y: 0 };

if (typeof window !== "undefined") {
  window.addEventListener(
    "click",
    (e) => {
      clickCoords = { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true },
  );
}

const NOISE_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='1' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.8 0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/></svg>`,
);

const _stylesInjected = false;
function injectStyles(x: number, y: number, maxRadius: number) {
  let style = document.getElementById("nexora-vt-styles");
  if (!style) {
    style = document.createElement("style");
    style.id = "nexora-vt-styles";
    document.head.appendChild(style);
  }

  style.textContent = `
    ::view-transition-old(root) {
      animation: none;
      mix-blend-mode: normal;
      z-index: 1;
    }
    ::view-transition-new(root) {
      animation: nexora-radial-reveal 800ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
      mix-blend-mode: normal;
      z-index: 99999;
    }
    @keyframes nexora-radial-reveal {
      from {
        clip-path: circle(0px at ${x}px ${y}px);
      }
      to {
        clip-path: circle(${maxRadius}px at ${x}px ${y}px);
      }
    }
    .sandstorm-wave-overlay {
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 10px;
      height: 10px;
      margin-left: -5px;
      margin-top: -5px;
      pointer-events: none;
      z-index: 999999;
      border-radius: 50%;
      background-image: url("data:image/svg+xml;utf8,${NOISE_SVG}");
      opacity: 0.85;
      transform: scale(0);
      will-change: transform, opacity;
      box-shadow: 0 0 120px 80px currentColor;
    }
    .sandstorm-wave-active {
      transition: transform 800ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 800ms ease-out;
      transform: scale(${(maxRadius / 5) * 2.2});
      opacity: 0;
    }
  `;
}

export function runThemeCurtain(next: "light" | "dark", apply: () => void): void {
  if (typeof document === "undefined") {
    apply();
    return;
  }
  if (inFlight) {
    apply();
    return;
  }

  // @ts-expect-error — experimental API
  const startVT = (document as any).startViewTransition?.bind(document);
  if (!startVT) {
    apply();
    return;
  }

  const x = clickCoords.x || window.innerWidth / 2;
  const y = clickCoords.y || window.innerHeight / 2;
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  injectStyles(x, y, maxRadius);
  inFlight = true;

  // Create hardware accelerated sandstorm overlay
  const overlay = document.createElement("div");
  overlay.className = "sandstorm-wave-overlay";
  // Match particle color to destination theme
  overlay.style.color = next === "dark" ? "rgba(20, 21, 26, 0.95)" : "rgba(255, 255, 255, 0.95)";
  document.body.appendChild(overlay);

  // Trigger GPU animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("sandstorm-wave-active");
    });
  });

  startVT(() => apply()).finished.finally(() => {
    inFlight = false;
    setTimeout(() => overlay.remove(), 850);
  });
}
