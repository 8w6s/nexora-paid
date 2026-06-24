import {
  type BoxRenderable,
  RGBA,
  StyledText,
  type TextChunk,
  type TextRenderable,
} from "@opentui/core";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { theme, tint } from "./theme";

// =============================================================================
// HE THONG SAO LAY CAM HUNG TU VU TRU THAT
// =============================================================================
// 1. Magnitude tier - phan bo theo cap sang giong vu tru that:
//      tier 0 (dim,    60%): char "·" "˙" "."   - sao mo, hau het bau troi
//      tier 1 (med,    28%): char "*" "+" "•"   - sao trung binh
//      tier 2 (bright, 10%): char "✦" "✧" "✶"   - sao sang ro
//      tier 3 (super,   2%): tier 2 + halo trang - "minh tinh"
//
// 2. Mau theo phan bo Hertzsprung-Russell giam don:
//      70% blue-white | 18% white | 8% yellow | 3% orange | 1% red giant
//
// 3. Pulse: sin² envelope - dim phase dai, peak phase sac net.
//    Tier >= 2 them fast-jitter (atmospheric scintillation moi phong).
//
// 4. Milky-way band: tang density doc theo mot dai ngang (y ~= 55%).
//
// 5. Min distance lon (4 cells) + Poisson-like sampling -> sao khong sinh
//    chum dac. Density thap (0.0085) -> bau troi dem THAT, khong qua tay.
//
// 6. Exclusion zones: skip cells co text (top/bottom bar, center stack).
//    Sao SE KHONG bao giuw thay the vi tri text -> UI luon ro rang.
//
// =============================================================================

const STAR_DIM = ["·", "˙", "."];
const STAR_MED = ["*", "+", "•"];
const STAR_BRIGHT = ["✦", "✧", "✶"];
const PEAK_HOT = RGBA.fromInts(255, 255, 255, 255);

type StarColor = { weight: number; color: RGBA };
const STAR_COLORS: StarColor[] = [
  { weight: 70, color: RGBA.fromInts(200, 220, 255, 255) }, // blue-white (Sirius-like)
  { weight: 18, color: RGBA.fromInts(245, 245, 230, 255) }, // white
  { weight: 8, color: RGBA.fromInts(245, 220, 160, 255) }, // yellow (sun-like)
  { weight: 3, color: RGBA.fromInts(245, 180, 120, 255) }, // orange
  { weight: 1, color: RGBA.fromInts(240, 130, 110, 255) }, // red giant
];
const COLOR_TOTAL = STAR_COLORS.reduce((s, c) => s + c.weight, 0);

function pickStarColor(): RGBA {
  let r = Math.random() * COLOR_TOTAL;
  for (const s of STAR_COLORS) {
    if (r < s.weight) return s.color;
    r -= s.weight;
  }
  return STAR_COLORS[0].color;
}

function pickTier(): 0 | 1 | 2 | 3 {
  const r = Math.random();
  if (r < 0.6) return 0;
  if (r < 0.88) return 1;
  if (r < 0.98) return 2;
  return 3;
}

const STAR_DENSITY = 0.0085;
const STAR_MIN_DIST = 4;
const MILKY_BIAS = 0.5; // 50% sao spawn theo milky-way band, 50% uniform
const MILKY_CENTER = 0.55;
const MILKY_HALF = 0.18;

const STAR_BASE = 0.08;
const STAR_AMP_MIN = 0.45;
const STAR_AMP_MAX = 0.95;
const STAR_PERIOD_MIN = 1500;
const STAR_PERIOD_MAX = 3800;
const FADE_MS = 380;
const MIN_BLINKS = 2;
const MAX_BLINKS = 10;

const FRAME_INTERVAL = 16;

// Meteor: cham hon nua (2.2 - 3.8s), thua hon (5 - 12s).
const METEOR_INITIAL_MIN = 600;
const METEOR_INITIAL_MAX = 2000;
const METEOR_INTERVAL_MIN = 5000;
const METEOR_INTERVAL_MAX = 12000;
const METEOR_BURST_MAX = 1;
// FIX speed bi anh huong boi goc roi: thay duration co dinh bang SPEED co
// dinh (cells/ms). Goc ngang co distance dai (~80 cells), goc dung distance
// ngan (~25 cells); duration co dinh -> goc ngang nhanh hon goc dung 3-4x.
// Speed cells/ms = const -> duration = distance/speed -> moi goc deu cung
// toc do thi giac.
const METEOR_SPEED_MIN = 0.012; // cells/ms - cham
const METEOR_SPEED_MAX = 0.02; // cells/ms - vua
// Giu min/max duration nhu fallback cho safety, khong dung lam primary.
const METEOR_DURATION_MIN = 1500;
const METEOR_DURATION_MAX = 8000;
const METEOR_TAIL = 24;
const METEOR_STEP = 0.18;
const METEOR_ANGLE_MIN_DEG = 15;
const METEOR_ANGLE_MAX_DEG = 75;
const CELL_ASPECT = 2;
const METEOR_PADDING = 4;
const METEOR_FADE_EDGE = 200;

const NEWLINE = String.fromCharCode(10);

type Rect = { x: number; y: number; w: number; h: number };

type Star = {
  x: number;
  y: number;
  tier: 0 | 1 | 2 | 3;
  charSeed: number;
  color: RGBA;
  amp: number;
  base: number;
  period: number;
  phase: number;
  spawnAt: number;
  lifetime: number;
};

type Meteor = {
  at: number;
  duration: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  speed: number;
};

type MutableChunk = {
  __isChunk: true;
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes: number;
};

function brailleBit(col: number, row: number): number {
  if (col === 0) return row === 3 ? 6 : row;
  return row === 3 ? 7 : 3 + row;
}

function inAnyRect(x: number, y: number, rects: Rect[]): boolean {
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
  }
  return false;
}

function pickStarPosition(
  w: number,
  h: number,
  taken: Set<string>,
  exclusion: Rect[],
  maxAttempts = 60,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let yFrac: number;
    if (Math.random() < MILKY_BIAS) {
      // Bias toward milky-way band, gaussian-ish around center.
      const u = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // -1..1 roughly
      yFrac = MILKY_CENTER + u * MILKY_HALF;
    } else {
      yFrac = Math.random();
    }
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.max(0, Math.min(h - 1, yFrac * h)));
    if (inAnyRect(x, y, exclusion)) continue;
    let ok = true;
    for (let dx = -STAR_MIN_DIST + 1; dx < STAR_MIN_DIST && ok; dx++) {
      for (let dy = -STAR_MIN_DIST + 1; dy < STAR_MIN_DIST; dy++) {
        if (taken.has(`${x + dx},${y + dy}`)) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return { x, y };
  }
  return null;
}

function makeStar(x: number, y: number, t: number): Star {
  const tier = pickTier();
  const period = STAR_PERIOD_MIN + Math.random() * (STAR_PERIOD_MAX - STAR_PERIOD_MIN);
  const blinks = MIN_BLINKS + Math.floor(Math.random() * (MAX_BLINKS - MIN_BLINKS + 1));
  // Magnitude power-law: most stars dim, few bright (within tier).
  const ampRoll = (1 - Math.random()) ** 2.2;
  const amp = STAR_AMP_MIN + ampRoll * (STAR_AMP_MAX - STAR_AMP_MIN);
  // Tier scales the cap.
  const tierCap = tier === 0 ? 0.45 : tier === 1 ? 0.7 : tier === 2 ? 0.95 : 1.0;
  return {
    x,
    y,
    tier,
    charSeed: Math.floor(Math.random() * 3),
    color: pickStarColor(),
    amp: amp * tierCap,
    base: STAR_BASE,
    period,
    phase: Math.random() * Math.PI * 2,
    spawnAt: t,
    lifetime: blinks * period,
  };
}

function generateStars(w: number, h: number, t: number, exclusion: Rect[]): Star[] {
  if (w <= 0 || h <= 0) return [];
  // Effective area: subtract exclusion roughly.
  const totalArea = w * h;
  let excludedArea = 0;
  for (const r of exclusion) excludedArea += Math.max(0, r.w) * Math.max(0, r.h);
  const usable = Math.max(0, totalArea - excludedArea);
  const target = Math.floor(usable * STAR_DENSITY);
  const taken = new Set<string>();
  const stars: Star[] = [];
  for (let i = 0; i < target; i++) {
    const pos = pickStarPosition(w, h, taken, exclusion);
    if (!pos) break;
    taken.add(`${pos.x},${pos.y}`);
    const star = makeStar(pos.x, pos.y, t);
    star.spawnAt = t - Math.random() * star.lifetime;
    stars.push(star);
  }
  return stars;
}

export function StarryBackground(
  props: {
    meteor?: () => boolean;
    excludeCenter?: { wFrac: number; hFrac: number };
    excludeBars?: boolean;
  } = {},
) {
  const [stars, setStars] = createSignal<Star[]>([]);
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  const [meteors, setMeteors] = createSignal<Meteor[]>([]);
  const [now, setNow] = createSignal(performance.now());
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let meteorTimer: ReturnType<typeof setTimeout> | undefined;
  let box: BoxRenderable | undefined;
  let textRef: TextRenderable | undefined;
  let mounted = false;

  const exclusion = createMemo<Rect[]>(() => {
    const { w, h } = size();
    if (w <= 0 || h <= 0) return [];
    const rects: Rect[] = [];
    if (props.excludeBars !== false) {
      rects.push({ x: 0, y: 0, w, h: 1 });
      if (h >= 2) rects.push({ x: 0, y: h - 1, w, h: 1 });
    }
    if (props.excludeCenter) {
      const cw = Math.floor(w * props.excludeCenter.wFrac);
      const ch = Math.floor(h * props.excludeCenter.hFrac);
      const cx = Math.floor((w - cw) / 2);
      const cy = Math.floor((h - ch) / 2);
      rects.push({ x: cx, y: cy, w: cw, h: ch });
    }
    return rects;
  });

  const starMapBuf = new Map<string, { char: string; color: RGBA }>();
  const meteorMapBuf = new Map<string, { char: string; color: RGBA }>();
  const cellAccBuf = new Map<string, { dots: number; minT: number }>();

  const pool: MutableChunk[] = [];
  let poolLen = 0;
  const resetPool = () => {
    poolLen = 0;
  };
  const pushPooled = (text: string, fg: RGBA | undefined) => {
    if (poolLen > 0) {
      const prev = pool[poolLen - 1]!;
      const sameFg =
        (prev.fg === undefined && fg === undefined) ||
        (prev.fg !== undefined && fg !== undefined && prev.fg.equals(fg));
      if (sameFg && prev.bg === undefined && prev.attributes === 0) {
        prev.text += text;
        return;
      }
    }
    let slot = pool[poolLen];
    if (!slot) {
      slot = { __isChunk: true, text, fg, attributes: 0 };
      pool[poolLen] = slot;
    } else {
      slot.text = text;
      slot.fg = fg;
      slot.bg = undefined;
      slot.attributes = 0;
    }
    poolLen++;
  };
  const pushPooledRaw = (text: string) => {
    let slot = pool[poolLen];
    if (!slot) {
      slot = { __isChunk: true, text, attributes: 0 };
      pool[poolLen] = slot;
    } else {
      slot.text = text;
      slot.fg = undefined;
      slot.bg = undefined;
      slot.attributes = 0;
    }
    poolLen++;
  };

  const checkSize = () => {
    if (!box) return;
    const w = box.width || 0;
    const h = box.height || 0;
    if (w <= 0 || h <= 0) return;
    const cur = size();
    if (w === cur.w && h === cur.h && stars().length > 0) return;
    setSize({ w, h });
    setStars(generateStars(w, h, performance.now(), exclusion()));
  };

  const recycleStars = (t: number) => {
    const list = stars();
    if (!list.length) return;
    const { w, h } = size();
    let dirty = false;
    const taken = new Set<string>();
    const nextList: Star[] = [];
    for (const s of list) {
      if (t - s.spawnAt < s.lifetime) {
        taken.add(`${s.x},${s.y}`);
        nextList.push(s);
      } else {
        dirty = true;
      }
    }
    const ex = exclusion();
    const toReplace = list.length - nextList.length;
    for (let i = 0; i < toReplace; i++) {
      const pos = pickStarPosition(w, h, taken, ex);
      if (!pos) break;
      taken.add(`${pos.x},${pos.y}`);
      nextList.push(makeStar(pos.x, pos.y, t));
      dirty = true;
    }
    if (dirty) setStars(nextList);
  };

  const spawnMeteor = (): Meteor | null => {
    const { w, h } = size();
    if (w <= 0 || h <= 0) return null;
    const visualDeg =
      METEOR_ANGLE_MIN_DEG + Math.random() * (METEOR_ANGLE_MAX_DEG - METEOR_ANGLE_MIN_DEG);
    const visualRad = (visualDeg * Math.PI) / 180;
    const mathAngle = Math.atan(Math.tan(visualRad) / CELL_ASPECT);
    const direction = Math.random() < 0.5 ? -1 : 1;
    const dx = direction * Math.cos(mathAngle);
    const dy = Math.sin(mathAngle);
    const startY = -3 - Math.random() * Math.max(3, h * 0.3);
    const startX = direction > 0 ? -3 - Math.random() * w * 0.2 : w + 3 + Math.random() * w * 0.2;
    const dExitY = (h + METEOR_PADDING - startY) / Math.max(0.001, dy);
    const dExitX =
      direction > 0
        ? (w + METEOR_PADDING - startX) / Math.max(0.001, dx)
        : (startX + METEOR_PADDING) / Math.max(0.001, -dx);
    const distance = Math.min(dExitY, dExitX) + METEOR_TAIL;
    // FIX: pick SPEED truoc (cells/ms), tinh duration = distance/sped.
    // Cach cu: pick duration co dinh -> goc ngang (distance lon) bay nhanh,
    // goc dung (distance nho) bay cham. Voi cach moi, MOI goc deu cung
    // toc do thi giac.
    const speed = METEOR_SPEED_MIN + Math.random() * (METEOR_SPEED_MAX - METEOR_SPEED_MIN);
    const rawDuration = distance / speed;
    const duration = Math.max(METEOR_DURATION_MIN, Math.min(METEOR_DURATION_MAX, rawDuration));
    return {
      at: performance.now(),
      duration,
      startX,
      startY,
      dx,
      dy,
      speed,
    };
  };

  const scheduleNextSpawn = (initial: boolean) => {
    const delay = initial
      ? METEOR_INITIAL_MIN + Math.random() * (METEOR_INITIAL_MAX - METEOR_INITIAL_MIN)
      : METEOR_INTERVAL_MIN + Math.random() * (METEOR_INTERVAL_MAX - METEOR_INTERVAL_MIN);
    meteorTimer = setTimeout(() => {
      if (!mounted) return;
      if (props.meteor && !props.meteor()) {
        scheduleNextSpawn(false);
        return;
      }
      const count = 1 + Math.floor(Math.random() * METEOR_BURST_MAX);
      const fresh: Meteor[] = [];
      for (let i = 0; i < count; i++) {
        const m = spawnMeteor();
        if (m) fresh.push(m);
      }
      if (fresh.length > 0) setMeteors((prev) => [...prev, ...fresh]);
      scheduleNextSpawn(false);
    }, delay);
  };

  onMount(() => {
    mounted = true;
    checkSize();
    frameTimer = setInterval(() => {
      if (!mounted) return;
      const t = performance.now();
      setNow(t);
      checkSize();
      recycleStars(t);
      setMeteors((prev) => {
        const filtered = prev.filter((m) => t - m.at <= m.duration);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, FRAME_INTERVAL);
    scheduleNextSpawn(true);
  });

  onCleanup(() => {
    mounted = false;
    if (frameTimer) clearInterval(frameTimer);
    if (meteorTimer) clearTimeout(meteorTimer);
  });

  const content = createMemo(() => {
    const t = now();
    const list = stars();
    const ms = meteors();
    const ex = exclusion();
    const { w, h } = size();
    if (w <= 0 || h <= 0 || !list.length) return new StyledText([]);

    starMapBuf.clear();
    for (const s of list) {
      const age = t - s.spawnAt;
      if (age < 0 || age > s.lifetime) continue;
      const fadeIn = Math.min(1, age / FADE_MS);
      const fadeOut = Math.min(1, (s.lifetime - age) / FADE_MS);
      const lifeEnv = Math.min(fadeIn, fadeOut);

      // Sin² envelope: dim phase rong, peak sac net.
      const phase = (age / s.period) * Math.PI * 2 + s.phase;
      const sinV = (Math.sin(phase) + 1) * 0.5; // 0..1
      const pulse = sinV * sinV; // squared

      // Fast scintillation: chi sao tier >= 2 - moi tao cam giac "flicker"
      // do khi quyen, sao mo khong twinkle.
      let scint = 0;
      if (s.tier >= 2) {
        scint = (Math.sin(age * 0.04 + s.phase) + Math.sin(age * 0.073 + s.phase * 1.7)) * 0.04;
      }

      const b = s.base + s.amp * pulse * lifeEnv + scint;
      if (b < 0.05) continue;

      const charPool = s.tier === 0 ? STAR_DIM : s.tier === 1 ? STAR_MED : STAR_BRIGHT;
      const blinkIdx = Math.floor(age / s.period);
      const charIdx = (s.charSeed + blinkIdx) % charPool.length;
      const char = charPool[charIdx]!;

      // Mau: tint tu textDim sang star color theo b. Tier 3 + b cao -> them
      // hot tint trang.
      const baseColor = tint(theme.textDim, s.color, Math.min(1, b));
      const isHot = s.tier === 3 && b > 0.85;
      const color = isHot
        ? tint(baseColor, PEAK_HOT, Math.min(1, (b - 0.85) / 0.15) * 0.6)
        : baseColor;
      starMapBuf.set(`${s.x},${s.y}`, { char, color });
    }

    meteorMapBuf.clear();
    if (ms.length > 0) {
      const beamCore = RGBA.fromInts(255, 255, 255);
      const beamGlow = RGBA.fromInts(180, 215, 255);
      for (const m of ms) {
        const elapsed = t - m.at;
        if (elapsed < 0 || elapsed > m.duration) continue;
        const distance = elapsed * m.speed;
        const headX = m.startX + distance * m.dx;
        const headY = m.startY + distance * m.dy;
        const fadeIn = Math.min(1, elapsed / METEOR_FADE_EDGE);
        const fadeOut = Math.min(1, (m.duration - elapsed) / METEOR_FADE_EDGE);
        const envelope = Math.min(fadeIn, fadeOut);
        cellAccBuf.clear();
        const setDot = (px: number, py: number, age: number) => {
          const subX = Math.floor(px * 2);
          const subY = Math.floor(py * 4);
          const cx = subX >> 1;
          const cy = subY >> 2;
          if (cx < 0 || cx >= w || cy < 0 || cy >= h) return;
          // Meteor cell roi vao exclusion (sat text +- 1 cell padding) -> bo
          // qua. Cell xa text van duoc ve braille -> sao bang van bay qua khu
          // vuc, chi tranh dung cell co text.
          if (inAnyRect(cx, cy, ex)) return;
          const bit = brailleBit(subX & 1, subY & 3);
          const key = `${cx},${cy}`;
          const existing = cellAccBuf.get(key);
          cellAccBuf.set(key, {
            dots: (existing?.dots ?? 0) | (1 << bit),
            minT: Math.min(existing?.minT ?? Infinity, age),
          });
        };
        for (let tt = 0; tt <= METEOR_TAIL; tt += METEOR_STEP) {
          setDot(headX - tt * m.dx, headY - tt * m.dy, tt);
        }
        const headSubX = Math.floor(headX * 2);
        const headSubY = Math.floor(headY * 4);
        for (let dsx = -1; dsx <= 1; dsx++) {
          for (let dsy = -1; dsy <= 1; dsy++) {
            if (dsx * dsx + dsy * dsy > 1) continue;
            const subX = headSubX + dsx;
            const subY = headSubY + dsy;
            const cx = subX >> 1;
            const cy = subY >> 2;
            if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
            if (inAnyRect(cx, cy, ex)) continue;
            const bit = brailleBit(subX & 1, subY & 3);
            const key = `${cx},${cy}`;
            const existing = cellAccBuf.get(key);
            cellAccBuf.set(key, {
              dots: (existing?.dots ?? 0) | (1 << bit),
              minT: 0,
            });
          }
        }
        for (const [key, val] of cellAccBuf) {
          const fade = (1 - val.minT / METEOR_TAIL) ** 1.3 * envelope;
          const headBlend = Math.max(0, 1 - val.minT / 5);
          const color = tint(
            theme.textDim,
            tint(beamGlow, beamCore, headBlend),
            Math.max(0.02, fade),
          );
          meteorMapBuf.set(key, { char: String.fromCharCode(0x2800 + val.dots), color });
        }
      }
    }

    resetPool();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (inAnyRect(x, y, ex)) {
          pushPooled(" ", undefined);
          continue;
        }
        const key = `${x},${y}`;
        const overlay = meteorMapBuf.get(key);
        if (overlay) {
          pushPooled(overlay.char, overlay.color);
          continue;
        }
        const star = starMapBuf.get(key);
        if (star) {
          pushPooled(star.char, star.color);
          continue;
        }
        pushPooled(" ", undefined);
      }
      if (y < h - 1) pushPooledRaw(NEWLINE);
    }
    return new StyledText(pool.slice(0, poolLen) as unknown as TextChunk[]);
  });

  createEffect(() => {
    if (!textRef) return;
    textRef.content = content();
  });

  return (
    <box
      ref={(item: BoxRenderable) => {
        box = item;
      }}
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={0}
    >
      <text
        ref={(item: TextRenderable) => {
          textRef = item;
          item.content = content();
        }}
        width="100%"
        height="100%"
        wrapMode="none"
        selectable={false}
      />
    </box>
  );
}
