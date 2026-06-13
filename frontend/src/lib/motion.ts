import anime from "animejs";

/**
 * Small anime.js helpers for consistent, tasteful motion across the shop.
 * All effects no-op under prefers-reduced-motion (accessibility).
 */
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Fade + rise a single element into view.
export function fadeRise(el: Element | null, opts: { delay?: number; duration?: number } = {}) {
  if (!el || reduced()) {
    (el as HTMLElement | null)?.style.removeProperty("opacity");
    return;
  }
  anime({
    targets: el,
    opacity: [0, 1],
    translateY: [14, 0],
    duration: opts.duration ?? 520,
    delay: opts.delay ?? 0,
    easing: "cubicBezier(0.16, 1, 0.3, 1)",
  });
}

// Stagger a list of children (e.g. product cards, wizard fields) into view.
export function staggerIn(
  targets: string | NodeListOf<Element> | Element[],
  opts: { stagger?: number; duration?: number } = {},
) {
  if (reduced()) return;
  anime({
    targets,
    opacity: [0, 1],
    translateY: [16, 0],
    duration: opts.duration ?? 540,
    delay: anime.stagger(opts.stagger ?? 70),
    easing: "cubicBezier(0.16, 1, 0.3, 1)",
  });
}

// Slide one wizard step out and the next in (direction: 1 = forward, -1 = back).
export function slideStep(outEl: Element | null, inEl: Element | null, dir: 1 | -1 = 1) {
  if (reduced()) return;
  if (outEl)
    anime({
      targets: outEl,
      opacity: [1, 0],
      translateX: [0, -24 * dir],
      duration: 220,
      easing: "easeInQuad",
    });
  if (inEl)
    anime({
      targets: inEl,
      opacity: [0, 1],
      translateX: [24 * dir, 0],
      duration: 360,
      delay: 120,
      easing: "cubicBezier(0.16, 1, 0.3, 1)",
    });
}

// Subtle pop used for confirmations / success ticks.
export function pop(el: Element | null) {
  if (!el || reduced()) return;
  anime({
    targets: el,
    scale: [0.6, 1],
    opacity: [0, 1],
    duration: 500,
    easing: "easeOutElastic(1, .6)",
  });
}

// Gentle attention pulse (e.g. "payment received").
export function pulse(el: Element | null) {
  if (!el || reduced()) return;
  anime({ targets: el, scale: [1, 1.06, 1], duration: 600, easing: "easeInOutQuad" });
}
