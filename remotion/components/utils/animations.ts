/**
 * Shared animation utilities for the cinematic trailer aesthetic.
 *
 * Design rules enforced here:
 *  • Spring physics, never linear easing — all springs are critically/over-damped (no overshoot).
 *  • Vertical drift only (8–16px). Horizontal slides are intentionally absent.
 *  • Subtle scale reveals from 0.94–0.96 → 1.0. Never pop from 0.
 *  • Intro 18–24f, exit 10–14f, sibling stagger 4–6f.
 *  • Every interpolate() uses clamp:true on both ends.
 *  • Backgrounds are near-black (#0a0a0a), never pure #000.
 */
import { interpolate, spring, SpringConfig } from 'remotion';

// ─── Color palette ───────────────────────────────────────────────────────────
export const COLORS = {
  bg: '#0a0a0a',
  bgDeep: '#080808',
  cut: '#050505',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  textTertiary: 'rgba(255, 255, 255, 0.42)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.14)',
};

// ─── Timing constants (in frames) ────────────────────────────────────────────
export const TIMING = {
  intro: 22,        // text/element entrance (18–24)
  introLong: 26,    // hero entrance with letter-spacing settle
  exit: 12,         // outro (10–14)
  stagger: 5,       // sibling stagger (4–6)
  staggerWord: 4,   // per-word stagger (3–4)
  cut: 3,           // shared near-black "cut" frame between scenes
  fadeBlackOut: 12, // fade-to-black out
  fadeBlackIn: 8,   // fade-from-black in
};

// ─── Spring configs ─────────────────────────────────────────────────────────
// Critically damped — the element settles cleanly with no overshoot.
const CLAMPED: { overshootClamping: true } = { overshootClamping: true };

export const SPRING_CALM: SpringConfig = {
  damping: 30,
  stiffness: 120,
  mass: 1,
  ...CLAMPED,
};

export const SPRING_TIGHT: SpringConfig = {
  damping: 36,
  stiffness: 180,
  mass: 1,
  ...CLAMPED,
};

export const SPRING_SETTLE: SpringConfig = {
  damping: 44,
  stiffness: 90,
  mass: 1,
  ...CLAMPED,
};

// ─── Primitives ─────────────────────────────────────────────────────────────

/** Standard fade-in over `duration` frames, starting at `delay`. */
export const fadeIn = (
  frame: number,
  delay: number = 0,
  duration: number = TIMING.intro
) =>
  interpolate(frame - delay, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/** Standard fade-out over `duration` frames, starting at `start`. */
export const fadeOut = (
  frame: number,
  start: number,
  duration: number = TIMING.exit
) =>
  interpolate(frame - start, [0, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/**
 * Fade + slight upward drift (8–16px → 0). The motion of choice for text entrances.
 * Returns { opacity, y } — apply y as translateY(${y}px).
 */
export const fadeUp = (
  frame: number,
  fps: number,
  delay: number = 0,
  distance: number = 12
) => {
  const f = frame - delay;
  const opacity = fadeIn(frame, delay, TIMING.intro);
  const y = spring({
    frame: f,
    fps,
    config: SPRING_CALM,
    from: distance,
    to: 0,
    durationInFrames: TIMING.intro,
  });
  return { opacity, y };
};

/**
 * Fast clean exit — opacity to 0 with slight downward drift.
 */
export const fadeDown = (
  frame: number,
  start: number,
  drift: number = 4
) => {
  const f = frame - start;
  const opacity = fadeOut(frame, start, TIMING.exit);
  const y = interpolate(f, [0, TIMING.exit], [0, drift], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return { opacity, y };
};

/**
 * Lifecycle for a single element: fade up at `enterAt`, fade down at `exitAt`.
 * Apply { opacity, transform: `translateY(${y}px)` }.
 */
export const lifecycle = (
  frame: number,
  fps: number,
  enterAt: number,
  exitAt: number,
  distance: number = 12
) => {
  const enter = fadeUp(frame, fps, enterAt, distance);
  const exit = fadeDown(frame, exitAt);
  return {
    opacity: Math.min(enter.opacity, exit.opacity),
    y: enter.y + exit.y,
  };
};

/**
 * Container/card reveal — scale 0.96 → 1.0 + fade.
 * Subtle and inevitable; never pops from 0.
 */
export const cardReveal = (
  frame: number,
  fps: number,
  delay: number = 0,
  fromScale: number = 0.96
) => {
  const f = frame - delay;
  const opacity = fadeIn(frame, delay, TIMING.intro);
  const scale = spring({
    frame: f,
    fps,
    config: SPRING_SETTLE,
    from: fromScale,
    to: 1,
    durationInFrames: TIMING.introLong,
  });
  return { opacity, scale };
};

/**
 * Letter-spacing settle — start slightly wide and settle to target on arrival.
 * Returns a CSS-ready em string.
 */
export const letterSpacingSettle = (
  frame: number,
  delay: number = 0,
  startEm: number = 0.08,
  endEm: number = 0,
  duration: number = TIMING.introLong
) => {
  const ls = interpolate(frame - delay, [0, duration], [startEm, endEm], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return `${ls}em`;
};

/**
 * Word-stagger style for a single word.
 * Use with words.map((w, i) => <span key={i} style={wordStaggerStyle(...)}>{w}</span>)
 */
export const wordStaggerStyle = (
  frame: number,
  fps: number,
  index: number,
  baseDelay: number = 0,
  perWord: number = TIMING.staggerWord,
  distance: number = 10
) => {
  const { opacity, y } = fadeUp(frame, fps, baseDelay + index * perWord, distance);
  return {
    opacity,
    transform: `translateY(${y}px)`,
    display: 'inline-block',
  };
};

/**
 * Slow Ken Burns over a media element. Subtle by default — no zoom-through.
 */
export const kenBurns = (
  frame: number,
  duration: number,
  startScale: number = 1.04,
  endScale: number = 1.0
) =>
  interpolate(frame, [0, duration], [startScale, endScale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/**
 * Hairline progress — for an accent rule that draws in from 0 → 100%.
 */
export const drawIn = (
  frame: number,
  delay: number = 0,
  duration: number = TIMING.introLong
) =>
  interpolate(frame - delay, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/**
 * Scene wrapper opacity: fade-in, hold, fade-out. Used at the top of each scene.
 */
export const sceneFade = (
  frame: number,
  duration: number,
  inFrames: number = TIMING.fadeBlackIn,
  outFrames: number = TIMING.fadeBlackOut
) =>
  interpolate(
    frame,
    [0, inFrames, duration - outFrames, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

/**
 * Split a string into words; preserves single-word strings.
 */
export const splitWords = (s: string): string[] =>
  s.trim().split(/\s+/).filter(Boolean);
