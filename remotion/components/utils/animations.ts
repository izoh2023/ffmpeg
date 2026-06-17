/**
 * Shared animation utilities — cinematic podcast trailer aesthetic.
 *
 * Design rules:
 *  • Spring physics, never linear easing (except intentional linear pops).
 *  • Critically/over-damped springs everywhere except SPRING_SLAM (overshoot intended).
 *  • Vertical drift only (8–16px). Horizontal only for deliberate "slide from side" effects.
 *  • Subtle scale reveals from 0.94 → 1.0. SPRING_SLAM can go 7.0 → 1.0.
 *  • Every interpolate() uses clamp on both ends.
 *  • Backgrounds: NAVY #111527, near-black #0a0a0a. Never pure #000.
 */
import { interpolate, spring, SpringConfig, Easing } from 'remotion';

// ─── Brand color palette ─────────────────────────────────────────────────────
export const COLORS = {
  // Generic near-black (non-brand scenes)
  bg: '#0a0a0a',
  bgDeep: '#080808',
  cut: '#050505',
  // Brand
  navy: '#111527',
  gold: '#F1AB1C',
  cream: '#F6F0E2',
  // Text utilities
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  textTertiary: 'rgba(255, 255, 255, 0.42)',
  textNavy: '#111527',
  textCream: '#F6F0E2',
  textCreamDim: 'rgba(246, 240, 226, 0.65)',
  // Lines
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.14)',
};

// ─── Font families ───────────────────────────────────────────────────────────
// Install: npm install @remotion/google-fonts
// In Root.tsx: import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay'
//              import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat'
//              loadPlayfair(); loadMontserrat();
export const FONT_DISPLAY = "'Playfair Display', Georgia, serif";
export const FONT_BODY    = "'Montserrat', system-ui, sans-serif";

// ─── Timing constants (frames) ──────────────────────────────────────────────
export const TIMING = {
  intro: 22,        // text/element entrance (18–24)
  introLong: 26,    // hero entrance with letter-spacing settle
  exit: 12,         // outro (10–14)
  stagger: 5,       // sibling stagger (4–6)
  staggerWord: 4,   // per-word stagger (3–4)
  cut: 3,           // near-black "cut" frame between scenes
  fadeBlackOut: 12, // fade-to-black out
  fadeBlackIn: 8,   // fade-from-black in
};

// ─── Spring configs ──────────────────────────────────────────────────────────
const CLAMPED: { overshootClamping: true } = { overshootClamping: true };

/** Gentle, critically damped — text entrances. */
export const SPRING_CALM: SpringConfig = {
  damping: 30, stiffness: 120, mass: 1, ...CLAMPED,
};

/** Snappy settle — cards and overlays. */
export const SPRING_TIGHT: SpringConfig = {
  damping: 36, stiffness: 180, mass: 1, ...CLAMPED,
};

/** Slow, smooth settle — logo reveals. */
export const SPRING_SETTLE: SpringConfig = {
  damping: 44, stiffness: 90, mass: 1, ...CLAMPED,
};

/**
 * Physical slam — intentional overshoot for logo entrance and title slams.
 * Used where the brief says "spring bounce" or "snap to final scale with slight overshoot".
 * damping: 12, stiffness: 200 per the brief's typography rules.
 */
export const SPRING_SLAM: SpringConfig = {
  damping: 12,
  stiffness: 200,
  mass: 1,
  overshootClamping: false, // allow overshoot — this is intentional
};

// ─── Easing ──────────────────────────────────────────────────────────────────
/** Expo-out — fast in, glides to stop. Great for slides and fades. */
export const EASE_EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1);

// ─── Primitive animations ────────────────────────────────────────────────────

export const fadeIn = (
  frame: number,
  delay: number = 0,
  duration: number = TIMING.intro
) =>
  interpolate(frame - delay, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

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
 * Fade + upward drift. The default text entrance.
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

export const lifecycle = (
  frame: number,
  fps: number,
  enterAt: number,
  exitAt: number,
  distance: number = 12
) => {
  const enter = fadeUp(frame, fps, enterAt, distance);
  const exit  = fadeDown(frame, exitAt);
  return {
    opacity: Math.min(enter.opacity, exit.opacity),
    y: enter.y + exit.y,
  };
};

/**
 * Container/card reveal — scale 0.96 → 1.0 + fade.
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

export const drawIn = (
  frame: number,
  delay: number = 0,
  duration: number = TIMING.introLong
) =>
  interpolate(frame - delay, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

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

export const splitWords = (s: string): string[] =>
  s.trim().split(/\s+/).filter(Boolean);

/**
 * Kinetic word pop — scale 1.18 → 1.0 with a fast decisive spring + fade-in.
 * Returns { opacity, scale }.
 */
export const wordPop = (
  frame: number,
  fps: number,
  index: number,
  baseDelay: number = 0,
  perWord: number = 3
) => {
  const f = frame - baseDelay - index * perWord;
  const opacity = interpolate(f, [0, 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = spring({
    frame: Math.max(0, f),
    fps,
    config: { damping: 22, stiffness: 300, mass: 0.85, overshootClamping: true },
    from: 1.18,
    to: 1.0,
    durationInFrames: 10,
  });
  return { opacity, scale };
};

/**
 * Logo slam — scale `from` → 1.0 with intentional spring overshoot.
 * Also returns blurPx derived from scale (blurred at large scale, clear at 1.0).
 */
export const logoSlam = (
  frame: number,
  fps: number,
  delay: number = 4,
  fromScale: number = 7.0
) => {
  const f = frame - delay;
  const scale = spring({
    frame: Math.max(0, f),
    fps,
    config: SPRING_SLAM,
    from: fromScale,
    to: 1.0,
    durationInFrames: 30,
  });
  // Blur tracks scale: fully clear at 1.0, heavily blurred at 3+ scale
  const blurPx = interpolate(scale, [1.0, 2.0, fromScale], [0, 6, 22], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = fadeIn(frame, delay, 8);
  return { scale, blurPx, opacity };
};

/**
 * Typewriter — returns number of visible characters.
 * Start at `startFrame`, reveal one char every `framesPerChar` frames.
 */
export const typewriterChars = (
  frame: number,
  totalChars: number,
  startFrame: number = 0,
  framesPerChar: number = 2
): number =>
  Math.min(totalChars, Math.max(0, Math.floor((frame - startFrame) / framesPerChar)));

/**
 * Breathing pulse — subtle sinusoidal scale for the pull quote block.
 * Returns a scale value near 1.0 (e.g. 1.003 peak).
 */
export const breathePulse = (
  frame: number,
  fps: number,
  amplitude: number = 0.005
): number =>
  1 + amplitude * Math.sin((frame / fps) * Math.PI);

/**
 * Zoom push — scale 1.0 → target in `duration` frames starting at `startFrame`.
 * Used at the end of clips before a hard cut.
 */
export const zoomPush = (
  frame: number,
  startFrame: number,
  duration: number = 6,
  targetScale: number = 1.08
) =>
  interpolate(frame, [startFrame, startFrame + duration], [1.0, targetScale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

/**
 * Slide down from above — for episode title slam in Outro.
 * Returns { y, opacity }.
 */
export const slideFromAbove = (
  frame: number,
  fps: number,
  delay: number = 0,
  fromY: number = -80
) => {
  const f = frame - delay;
  const opacity = fadeIn(frame, delay, 10);
  const y = spring({
    frame: Math.max(0, f),
    fps,
    config: SPRING_SLAM, // intentional bounce
    from: fromY,
    to: 0,
    durationInFrames: 28,
  });
  return { opacity, y };
};
