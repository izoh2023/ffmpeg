import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TrailerProps, TrailerBeat } from '../types';
import { buildTimeline } from '../utils/timing';
import { resolveBranding } from '../utils/branding';
import { EASE_EXPO_OUT } from '../components/utils/animations';
import { useFonts } from '../components/useFonts';
import { Intro } from '../components/Intro';
import { GuestCard } from '../components/GuestCard';
import { ClipSegment } from '../components/ClipSegment';
import { Transition } from '../components/Transition';
import { PullQuote } from '../components/PullQuote';
import { Outro } from '../components/Outro';
import { RawVideoScene } from '../components/RawVideoScene';

// ─── Music ducking levels ────────────────────────────────────────────────────
const MUSIC_FULL    = 1;
const MUSIC_DUCKED  = 0.30;  // under the pull quote
const MUSIC_CLIPS   = 0.18;  // quieter under speech-heavy clips

export const Trailer: React.FC<TrailerProps> = (props) => {
  const {
    clips, guest, episode, branding, motion, musicPath, musicTrimStart,
    hostSide = 'left', intro, outro,
  } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  useFonts();

  // Resolve the user-supplied branding once, then thread the fully-populated
  // theme to every scene so they never need to know about defaults.
  const resolvedBranding = resolveBranding(branding);

  const timeline = buildTimeline(props);

  // ─── Anchor points for the music curve ──────────────────────────────────
  const introEnd       = timeline.intro.start + timeline.intro.duration;
  const pullQuoteStart = timeline.pullQuote.start;
  const pullQuoteEnd   = pullQuoteStart + timeline.pullQuote.duration;
  const outroStart     = timeline.outro.start;

  const clipBeats = timeline.beats.filter((b) => b.kind === 'clip');
  const firstClipStart = clipBeats[0]?.start ?? introEnd;
  const lastClipEnd =
    (clipBeats[clipBeats.length - 1]?.start ?? 0) +
    (clipBeats[clipBeats.length - 1]?.duration ?? 0);

  // ─── Music volume curve ─────────────────────────────────────────────────
  const musicVolume = (() => {
    if (frame < 20) {
      return interpolate(frame, [0, 20], [0, MUSIC_FULL], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: EASE_EXPO_OUT,
      });
    }
    if (frame < introEnd) return MUSIC_FULL;

    if (frame < firstClipStart + 24) {
      return interpolate(
        frame,
        [introEnd, firstClipStart + 24],
        [MUSIC_FULL, MUSIC_CLIPS],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_EXPO_OUT }
      );
    }
    if (frame < lastClipEnd) return MUSIC_CLIPS;

    if (frame < pullQuoteStart + 18) {
      return interpolate(
        frame,
        [lastClipEnd, pullQuoteStart + 18],
        [MUSIC_CLIPS, MUSIC_DUCKED],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_EXPO_OUT }
      );
    }
    if (frame < pullQuoteEnd) return MUSIC_DUCKED;

    if (frame < outroStart + 30) {
      return interpolate(
        frame,
        [pullQuoteEnd, outroStart + 30],
        [MUSIC_DUCKED, MUSIC_FULL],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_EXPO_OUT }
      );
    }

    return interpolate(
      frame,
      [durationInFrames - 2 * fps, durationInFrames],
      [MUSIC_FULL, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_EXPO_OUT }
    );
  })();

  // ─── Dispatch each beat ─────────────────────────────────────────────────
  const renderBeat = (beat: TrailerBeat, key: number) => {
    switch (beat.kind) {
      case 'intro':
        return (
          <Sequence key={key} from={beat.start} durationInFrames={beat.duration}>
            {intro ? (
              <RawVideoScene videoPath={intro.videoPath} durationInFrames={beat.duration} />
            ) : (
              <Intro branding={resolvedBranding} episode={episode} motion={motion} />
            )}
          </Sequence>
        );

      case 'guestCard':
        return (
          <Sequence key={key} from={beat.start} durationInFrames={beat.duration}>
            <GuestCard guest={guest} branding={resolvedBranding} motion={motion} />
          </Sequence>
        );

      case 'clip': {
        const idx = beat.clipIdx ?? 0;
        const clip = clips[idx];
        if (!clip) return null;
        return (
          <Sequence key={key} from={beat.start} durationInFrames={beat.duration}>
            <ClipSegment
              clip={clip}
              guest={guest}
              branding={resolvedBranding}
              motion={motion}
              clipIndex={idx}
              totalClips={clips.length}
              isFirst={beat.isFirst}
              hostSide={hostSide}
            />
          </Sequence>
        );
      }

      case 'transition':
        return (
          <Sequence key={key} from={beat.start} durationInFrames={beat.duration}>
            <Transition
              title={beat.title ?? ''}
              branding={resolvedBranding}
              motion={motion}
            />
          </Sequence>
        );

      case 'pullQuote':
        return (
          <Sequence key={key} from={beat.start} durationInFrames={beat.duration}>
            <PullQuote episode={episode} branding={resolvedBranding} />
          </Sequence>
        );

      case 'outro':
        return (
          <Sequence key={key} from={beat.start} durationInFrames={beat.duration}>
            {outro ? (
              <RawVideoScene videoPath={outro.videoPath} durationInFrames={beat.duration} />
            ) : (
              <Outro branding={resolvedBranding} episode={episode} musicPath={musicPath} motion={motion} />
            )}
          </Sequence>
        );
    }
  };

  return (
    // Top-level backdrop picks up the resolved navy — never seen at full
    // opacity (every scene paints its own bg), but catches frame seams.
    <AbsoluteFill style={{ backgroundColor: resolvedBranding.colors.navy }}>
      <Audio
        src={musicPath}
        volume={musicVolume}
        startFrom={Math.round((musicTrimStart ?? 0) * fps)}
      />

      {timeline.beats.map((beat, i) => renderBeat(beat, i))}
    </AbsoluteFill>
  );
};
