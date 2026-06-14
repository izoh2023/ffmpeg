import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TrailerProps } from '../types';
import { buildTimeline, FADE_FRAMES } from '../utils/timing';
import { Intro } from '../components/Intro';
import { GuestCard } from '../components/GuestCard';
import { ClipSegment } from '../components/ClipSegment';
import { Transition } from '../components/Transition';
import { Outro } from '../components/Outro';

// ─── Tune these two values to control music volume ────────────────────────────
const MUSIC_FULL_VOLUME   = 1;    // during intro and outro
const MUSIC_DUCKED_VOLUME = 0.15; // during clips (lower = quieter under speech)

export const Trailer: React.FC<TrailerProps> = (props) => {
  const { clips, guest, episode, branding, musicPath } = props;
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const timeline = buildTimeline(props);

  // ─── Music volume ducking ─────────────────────────────────────────────────
  const introEnd   = timeline.intro.start + timeline.intro.duration;
  const outroStart = timeline.outro.start;

  const musicVolume = (() => {
    // Fade in at start
    if (frame < timeline.intro.start + 15) {
      return interpolate(frame, [0, 15], [0, MUSIC_FULL_VOLUME], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }
    // Full during intro
    if (frame < introEnd) return MUSIC_FULL_VOLUME;

    // Duck down during guest card + clips
    if (frame < introEnd + 15) {
      return interpolate(frame, [introEnd, introEnd + 15], [MUSIC_FULL_VOLUME, MUSIC_DUCKED_VOLUME], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }

    // Stay ducked through clips
    if (frame < outroStart - 15) return MUSIC_DUCKED_VOLUME;

    // Swell back up for outro
    if (frame < outroStart + 20) {
      return interpolate(frame, [outroStart - 15, outroStart + 20], [MUSIC_DUCKED_VOLUME, MUSIC_FULL_VOLUME], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }

    // Fade out at very end
    return interpolate(
      frame,
      [durationInFrames - 20, durationInFrames],
      [MUSIC_FULL_VOLUME, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
    );
  })();

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>

      {/* ─── Music bed ──────────────────────────────────────────────────── */}
      <Audio
        src={musicPath}
        volume={musicVolume}
      />

      {/* ─── Intro ──────────────────────────────────────────────────────── */}
      <Sequence
        from={timeline.intro.start}
        durationInFrames={timeline.intro.duration}
      >
        <Intro branding={branding} episode={episode} />
      </Sequence>

      {/* ─── Guest card ─────────────────────────────────────────────────── */}
      <Sequence
        from={timeline.guestCard.start}
        durationInFrames={timeline.guestCard.duration}
      >
        <GuestCard
          guest={guest}
          branding={branding}
          firstClip={clips[0]}
        />
      </Sequence>

      {/* ─── Clips + transitions ────────────────────────────────────────── */}
      {clips.map((clip, i) => (
        <React.Fragment key={i}>

          {/* Clip segment */}
          <Sequence
            from={timeline.clips[i].start}
            durationInFrames={timeline.clips[i].duration}
          >
            <ClipSegment
              clip={clip}
              guest={guest}
              branding={branding}
              isFirst={i === 0}
            />
          </Sequence>

          {/* Transition after every clip except last */}
          {i < clips.length - 1 && timeline.transitions[i] && (
            <Sequence
              from={timeline.transitions[i].start}
              durationInFrames={timeline.transitions[i].duration}
            >
              <Transition
                title={clips[i + 1].title}
                branding={branding}
              />
            </Sequence>
          )}

        </React.Fragment>
      ))}

      {/* ─── Outro ──────────────────────────────────────────────────────── */}
      <Sequence
        from={timeline.outro.start}
        durationInFrames={timeline.outro.duration}
      >
        <Outro
          branding={branding}
          episode={episode}
          musicPath={musicPath}
        />
      </Sequence>

    </AbsoluteFill>
  );
};