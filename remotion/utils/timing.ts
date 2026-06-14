import { TrailerProps, TrailerTimeline, SectionTiming } from '../types';

const FPS = 30;

// ─── Section durations in frames ─────────────────────────────────────────────
export const INTRO_FRAMES       = 3 * FPS;   // 3 seconds
export const GUEST_CARD_FRAMES  = 4 * FPS;   // 4 seconds
export const TRANSITION_FRAMES  = 2 * FPS;   // 2 seconds (fade out + topic card + fade in)
export const OUTRO_FRAMES       = 4 * FPS;   // 4 seconds
export const FADE_FRAMES        = 15;        // 0.5s fade each side of transition

export const secToFrames = (seconds: number): number =>
  Math.round(seconds * FPS);

export function buildTimeline(props: TrailerProps): TrailerTimeline {
  const { clips } = props;

  let cursor = 0;

  // ─── Intro ────────────────────────────────────────────────────────────────
  const intro: SectionTiming = { start: cursor, duration: INTRO_FRAMES };
  cursor += INTRO_FRAMES;

  // ─── Guest card ───────────────────────────────────────────────────────────
  const guestCard: SectionTiming = { start: cursor, duration: GUEST_CARD_FRAMES };
  cursor += GUEST_CARD_FRAMES;

  // ─── Clips + transitions ──────────────────────────────────────────────────
  const clipTimings: SectionTiming[] = [];
  const transitionTimings: SectionTiming[] = [];

  clips.forEach((clip, i) => {
    const clipFrames = secToFrames(clip.duration);

    clipTimings.push({ start: cursor, duration: clipFrames });
    cursor += clipFrames;

    // Add transition after every clip except the last
    if (i < clips.length - 1) {
      transitionTimings.push({ start: cursor, duration: TRANSITION_FRAMES });
      cursor += TRANSITION_FRAMES;
    }
  });

  // ─── Outro ────────────────────────────────────────────────────────────────
  const outro: SectionTiming = { start: cursor, duration: OUTRO_FRAMES };
  cursor += OUTRO_FRAMES;

  return {
    intro,
    guestCard,
    clips: clipTimings,
    transitions: transitionTimings,
    outro,
    totalFrames: cursor,
  };
}