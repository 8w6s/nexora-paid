import {
  RGBA,
  StyledText,
  TextAttributes,
  type TextChunk,
  type TextRenderable,
} from "@opentui/core";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { theme, tint } from "./theme";

// ASCII art "NEXORA PAID" 3 dong, width=47.
const NEXORA = [
  " █▀█ █▀▀ █ █ █▀█ █▀▄ █▀█   █▀█ █▀█ █▀█ █▀▀ █  ",
  " █ █ █▀▀ ▄▀▄ █ █ █▀▄ █▀█   █▀▀ █▀█ █ █ █▀▀ █  ",
  " ▀ ▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀ ▀ ▀ ▀   ▀   ▀ ▀ ▀ ▀ ▀▀▀ ▀▀▀",
];
const NEXORA_END_COL = 24;

const NEXORA_BASE = RGBA.fromInts(70, 130, 220, 255);
const PANEL_BASE = RGBA.fromInts(140, 142, 152, 255);
const PRIMARY = RGBA.fromInts(0, 220, 255, 255);
// Off-white am cyan thay vi pure white -> tranh tay trang logo cung.
const PEAK = RGBA.fromInts(220, 240, 255, 255);

const SWEEP_DURATION = 2600;
const SWEEP_INTERVAL = SWEEP_DURATION + 7000;
const SWEEP_BAND = 4.5;
const SWEEP_AMP = 1.2;
const FRAME_INTERVAL = 16;

// Shimmer rings: amps giam manh tu phien ban cu (CORE 2.6 -> 1.4, SOFT 1.9 -> 0.95)
// + PEAK_MIX 0.55 thay vi 0.85 -> shimmer ro nhung khong "blast trang" toan logo.
const SHIMMER_PERIOD = 6500;
const SHIMMER_RINGS = 2;
const SHIMMER_CORE_WIDTH = 1.4;
const SHIMMER_CORE_AMP = 1.4;
const SHIMMER_SOFT_WIDTH = 11;
const SHIMMER_SOFT_AMP = 0.95;
const SHIMMER_TAIL = 6;
const SHIMMER_TAIL_AMP = 0.45;
const SHIMMER_HALO_WIDTH = 4.6;
const SHIMMER_HALO_OFFSET = 0.6;
const SHIMMER_HALO_AMP = 0.18;
const SHIMMER_BREATH_BASE = 0.04;
const SHIMMER_NOISE = 0.12;
const SHIMMER_AMBIENT_AMP = 0.32;
const SHIMMER_AMBIENT_CENTER = 0.5;
const SHIMMER_AMBIENT_WIDTH = 0.36;
const SHIMMER_PRIMARY_MIX = 0.45;
const SHIMMER_PEAK_MIX = 0.55;
const SHIMMER_ORIGIN_X = -2;
const SHIMMER_ORIGIN_Y = 3;

// UFO scanner bar tren logo.
const UFO_FRAME_INTERVAL = 28;
const UFO_HOLD_START = 4;
const UFO_HOLD_END = 4;
const UFO_TRAIL = ["·", "∙", "˙"];
const UFO_TRAIL_LEN = 4;

function clamp(n: number) {
  return Math.max(0, Math.min(1, n));
}

function ease(t: number) {
  const p = clamp(t);
  return p * p * (3 - 2 * p);
}

function glow(base: RGBA, n: number): RGBA {
  const mid = tint(base, PRIMARY, 0.84);
  const top = tint(PRIMARY, PEAK, 0.96);
  if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14));
  return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))));
}

function shade(base: RGBA, n: number): RGBA {
  if (n >= 0) return glow(base, n);
  return tint(base, RGBA.fromInts(8, 8, 10, 255), Math.min(0.82, -n * 0.64));
}

function shimmerNoise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453;
  return n - Math.floor(n);
}

type ShimmerRing = { head: number; eased: number; ambient: number };

function buildShimmerRings(
  t: number,
  width: number,
  height: number,
): {
  rings: ShimmerRing[];
  count: number;
} {
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  let maxCorner = 0;
  for (const [cx, cy] of corners) {
    const d = Math.hypot(cx - SHIMMER_ORIGIN_X, cy - SHIMMER_ORIGIN_Y);
    if (d > maxCorner) maxCorner = d;
  }
  const reach = maxCorner + SHIMMER_TAIL * 2;
  const count = Math.max(1, SHIMMER_RINGS);
  const rings: ShimmerRing[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i / count;
    const phase = (((t / SHIMMER_PERIOD + offset) % 1) + 1) % 1;
    const envelope = Math.sin(phase * Math.PI);
    const eased = envelope * envelope * (3 - 2 * envelope);
    const d = (phase - SHIMMER_AMBIENT_CENTER) / SHIMMER_AMBIENT_WIDTH;
    rings.push({
      head: phase * reach,
      eased,
      ambient: Math.abs(d) < 1 ? (1 - d * d) ** 2 * SHIMMER_AMBIENT_AMP : 0,
    });
  }
  return { rings, count };
}

function shimmerSample(
  x: number,
  pixelY: number,
  t: number,
  rings: ShimmerRing[],
  count: number,
): { peak: number; primary: number } {
  const dx = x + 0.5 - SHIMMER_ORIGIN_X;
  const dy = pixelY - SHIMMER_ORIGIN_Y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const wob1 = shimmerNoise(x * 0.32, pixelY * 0.25, t * 0.0005) - 0.5;
  const wob2 = shimmerNoise(x * 0.12, pixelY * 0.08, t * 0.00022) - 0.5;
  const ripple = Math.sin(angle * 3 + t * 0.0012) * 0.3;
  const jitter = (wob1 * 0.55 + wob2 * 0.32 + ripple * 0.18) * SHIMMER_NOISE;
  const traveled = dist + jitter;
  let peak = 0;
  let halo = 0;
  let primary = 0;
  let ambient = 0;
  for (const ring of rings) {
    const delta = traveled - ring.head;
    const core = Math.exp(-(Math.abs(delta / SHIMMER_CORE_WIDTH) ** 1.8));
    const soft = Math.exp(-(Math.abs(delta / SHIMMER_SOFT_WIDTH) ** 1.6));
    const tailRange = SHIMMER_TAIL * 2.6;
    const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0;
    const haloDelta = delta + SHIMMER_HALO_OFFSET;
    const haloBand = Math.exp(-(Math.abs(haloDelta / SHIMMER_HALO_WIDTH) ** 1.6));
    peak +=
      (core * SHIMMER_CORE_AMP + soft * SHIMMER_SOFT_AMP + tail * SHIMMER_TAIL_AMP) * ring.eased;
    halo += haloBand * SHIMMER_HALO_AMP * ring.eased;
    primary += (haloBand + tail * 0.6) * ring.eased;
    ambient += ring.ambient;
  }
  ambient /= count;
  return {
    peak: SHIMMER_BREATH_BASE + ambient + (peak + halo) / count,
    primary: (primary / count) * SHIMMER_PRIMARY_MIX,
  };
}

function sweepGlow(x: number, y: number, sweepStart: number, t: number, width: number): number {
  const age = t - sweepStart;
  if (age < 0 || age > SWEEP_DURATION) return 0;
  const p = age / SWEEP_DURATION;
  const head = -3 + (width + 6) * ease(p);
  const dx = x + 0.5 - head;
  const band = Math.exp(-((dx / SWEEP_BAND) ** 2));
  const core = Math.exp(-((dx / 1.3) ** 2)) * 1.7;
  const env = Math.sin(p * Math.PI);
  const wobble = 1 + 0.08 * Math.sin(y * 0.9 + p * 6);
  return (band * 0.7 + core) * env * SWEEP_AMP * wobble;
}

function pushChunk(
  chunks: TextChunk[],
  text: string,
  fg: RGBA,
  bg: RGBA | undefined,
  bold: boolean,
) {
  const attrs = bold ? TextAttributes.BOLD : 0;
  const prev = chunks.at(-1);
  const sameBg =
    prev?.bg === bg ||
    (prev?.bg && bg && prev.bg.equals(bg)) ||
    (prev?.bg === undefined && bg === undefined);
  if (prev && prev.fg?.equals(fg) && sameBg && prev.attributes === attrs) {
    prev.text += text;
    return;
  }
  chunks.push({ __isChunk: true, text, fg, bg, attributes: attrs });
}

type ScannerState = {
  activePos: number;
  movingForward: boolean;
  trailScale: number;
};

function getScannerState(frameIndex: number, totalChars: number): ScannerState {
  const forward = totalChars;
  const backward = totalChars - 1;
  const cycle = forward + UFO_HOLD_END + backward + UFO_HOLD_START;
  const f = ((frameIndex % cycle) + cycle) % cycle;
  if (f < forward) return { activePos: f, movingForward: true, trailScale: 1 };
  if (f < forward + UFO_HOLD_END) {
    const p = (f - forward) / UFO_HOLD_END;
    return { activePos: totalChars - 1, movingForward: true, trailScale: 1 - p };
  }
  if (f < forward + UFO_HOLD_END + backward) {
    return {
      activePos: totalChars - 2 - (f - forward - UFO_HOLD_END),
      movingForward: false,
      trailScale: 1,
    };
  }
  const p = (f - forward - UFO_HOLD_END - backward) / UFO_HOLD_START;
  return { activePos: 0, movingForward: false, trailScale: 1 - p };
}

export function Logo(_props: { active?: () => boolean } = {}) {
  const [now, setNow] = createSignal(performance.now());
  const [sweepStart, setSweepStart] = createSignal<number | undefined>(undefined);
  const [ufoFrame, setUfoFrame] = createSignal(0);
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let ufoTimer: ReturnType<typeof setInterval> | undefined;
  let sweepStartTimer: ReturnType<typeof setTimeout> | undefined;
  let sweepIntervalTimer: ReturnType<typeof setInterval> | undefined;
  let logoText: TextRenderable | undefined;
  let ufoText: TextRenderable | undefined;

  const fireSweep = () => setSweepStart(performance.now());

  onMount(() => {
    frameTimer = setInterval(() => setNow(performance.now()), FRAME_INTERVAL);
    ufoTimer = setInterval(() => setUfoFrame((n) => n + 1), UFO_FRAME_INTERVAL);
    sweepStartTimer = setTimeout(() => {
      fireSweep();
      sweepIntervalTimer = setInterval(fireSweep, SWEEP_INTERVAL);
    }, 1500);
  });

  onCleanup(() => {
    if (frameTimer) clearInterval(frameTimer);
    if (ufoTimer) clearInterval(ufoTimer);
    if (sweepStartTimer) clearTimeout(sweepStartTimer);
    if (sweepIntervalTimer) clearInterval(sweepIntervalTimer);
  });

  const totalWidth = NEXORA[0].length;

  const logoContent = createMemo(() => {
    const t = now();
    const start = sweepStart();
    const chunks: TextChunk[] = [];
    const { rings, count } = buildShimmerRings(t, totalWidth, NEXORA.length * 2);
    NEXORA.forEach((line, lineIdx) => {
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const base = i < NEXORA_END_COL ? NEXORA_BASE : PANEL_BASE;

        if (char === " ") {
          pushChunk(chunks, " ", base, undefined, false);
          continue;
        }

        const sTop = start === undefined ? 0 : sweepGlow(i, lineIdx * 2, start, t, totalWidth);
        const sBot = start === undefined ? 0 : sweepGlow(i, lineIdx * 2 + 1, start, t, totalWidth);
        const shTop = shimmerSample(i, lineIdx * 2, t, rings, count);
        const shBot = shimmerSample(i, lineIdx * 2 + 1, t, rings, count);

        const baseTopPrim =
          shTop.primary > 0 ? tint(base, PRIMARY, Math.min(1, shTop.primary)) : base;
        const baseBotPrim =
          shBot.primary > 0 ? tint(base, PRIMARY, Math.min(1, shBot.primary)) : base;
        const baseTopPeak =
          shTop.peak > 0
            ? tint(baseTopPrim, PEAK, Math.min(0.85, shTop.peak * SHIMMER_PEAK_MIX))
            : baseTopPrim;
        const baseBotPeak =
          shBot.peak > 0
            ? tint(baseBotPrim, PEAK, Math.min(0.85, shBot.peak * SHIMMER_PEAK_MIX))
            : baseBotPrim;
        const inkTop = shade(baseTopPeak, sTop);
        const inkBot = shade(baseBotPeak, sBot);

        if (char === "█") {
          pushChunk(chunks, "▀", inkTop, inkBot, true);
        } else if (char === "▀") {
          pushChunk(chunks, "▀", inkTop, undefined, true);
        } else if (char === "▄") {
          pushChunk(chunks, "▄", inkBot, undefined, true);
        } else {
          pushChunk(chunks, char, inkTop, undefined, true);
        }
      }
      if (lineIdx < NEXORA.length - 1) {
        chunks.push({ __isChunk: true, text: String.fromCharCode(10), attributes: 0 });
      }
    });
    return new StyledText(chunks);
  });

  const ufoContent = createMemo(() => {
    const frame = ufoFrame();
    const state = getScannerState(frame, totalWidth);
    const trailColors = [PEAK, PRIMARY, NEXORA_BASE, theme.textDim];
    const visibleTrail = Math.max(0, Math.ceil(UFO_TRAIL_LEN * state.trailScale));

    const chunks: TextChunk[] = [];
    for (let i = 0; i < totalWidth; i++) {
      const d = state.movingForward ? state.activePos - i : i - state.activePos;
      if (d === 0) {
        pushChunk(chunks, "✨", PEAK, undefined, false);
      } else if (d > 0 && d <= visibleTrail) {
        const ch = UFO_TRAIL[(frame + d) % UFO_TRAIL.length];
        const fg = trailColors[Math.min(d - 1, trailColors.length - 1)];
        pushChunk(chunks, ch, fg, undefined, false);
      } else {
        pushChunk(chunks, " ", theme.textDim, undefined, false);
      }
    }
    return new StyledText(chunks);
  });

  createEffect(() => {
    if (logoText) logoText.content = logoContent();
  });
  createEffect(() => {
    if (ufoText) ufoText.content = ufoContent();
  });

  return (
    <box flexDirection="column" alignItems="flex-start">
      <text
        ref={(item: TextRenderable) => {
          ufoText = item;
          item.content = ufoContent();
        }}
        wrapMode="none"
        selectable={false}
      />
      <text
        ref={(item: TextRenderable) => {
          logoText = item;
          item.content = logoContent();
        }}
        wrapMode="none"
        selectable={false}
      />
      <text fg={theme.textMuted} selectable={false}>
        {" ".repeat(Math.max(0, Math.floor((totalWidth - 24) / 2)))}— digital goods storefront —
      </text>
    </box>
  );
}
