import {
  TrailerProps,
  TrailerTimeline,
  TrailerBeat,
  SectionTiming,
} from '../types';

const FPS = 30;

// ─── Section durations (frames) ──────────────────────────────────────────────
export const INTRO_FRAMES        = 4 * FPS;                 // 120f
export const GUEST_CARD_FRAMES   = 5 * FPS;                 // 150f
export const TRANSITION_FRAMES   = Math.round(3.4 * FPS);   // 102f — typewriter title with full dwell
export const PULL_QUOTE_FRAMES   = 6 * FPS;                 // 180f
export const OUTRO_FRAMES        = 7 * FPS;                 // 210f
export const FADE_FRAMES         = 12;                       // 0.4s scene edge fade

export const secToFrames = (seconds: number): number =>
  Math.round(seconds * FPS);

export function buildTimeline(props: TrailerProps): TrailerTimeline {
  const { clips } = props;
  const beats: TrailerBeat[] = [];
  let cursor = 0;

  const push = (b: Omit<TrailerBeat, 'start'>): TrailerBeat => {
    const beat: TrailerBeat = { ...b, start: cursor };
    beats.push(beat);
    cursor += b.duration;
    return beat;
  };

  // ── 1. Intro ──────────────────────────────────────────────────────────────
  const introBeat = push({ kind: 'intro', duration: INTRO_FRAMES });

  // ── 2. Guest card ─────────────────────────────────────────────────────────
  const guestBeat = push({ kind: 'guestCard', duration: GUEST_CARD_FRAMES });

  // ── 3. Clips (full length, sequential) with transitions in between ────────
  clips.forEach((clip, i) => {
    push({
      kind: 'clip',
      duration: secToFrames(clip.duration),
      clipIdx: i,
      isFirst: i === 0,
    });

    if (i < clips.length - 1) {
      push({
        kind: 'transition',
        duration: TRANSITION_FRAMES,
        title: clips[i + 1].title,
      });
    }
  });

  // ── 4. Pull quote ─────────────────────────────────────────────────────────
  const pullQuoteBeat = push({ kind: 'pullQuote', duration: PULL_QUOTE_FRAMES });

  // ── 5. Outro ──────────────────────────────────────────────────────────────
  const outroBeat = push({ kind: 'outro', duration: OUTRO_FRAMES });

  // ── Top-level back-compat pointers ────────────────────────────────────────
  const intro: SectionTiming     = { start: introBeat.start,     duration: introBeat.duration };
  const guestCard: SectionTiming = { start: guestBeat.start,     duration: guestBeat.duration };
  const pullQuote: SectionTiming = { start: pullQuoteBeat.start, duration: pullQuoteBeat.duration };
  const outro: SectionTiming     = { start: outroBeat.start,     duration: outroBeat.duration };

  return {
    beats,
    intro,
    guestCard,
    pullQuote,
    outro,
    totalFrames: cursor,
  };
}
