import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from 'remotion';
import { BrandingProp, EpisodeProp } from '../types';
import {
  COLORS,
  TIMING,
  cardReveal,
  fadeUp,
  fadeOut,
  letterSpacingSettle,
  drawIn,
  splitWords,
  wordStaggerStyle,
} from './utils/animations';

interface IntroProps {
  branding: BrandingProp;
  episode: EpisodeProp;
}

/**
 * Cinematic intro.
 *
 * Beats:
 *   00–06f  near-black hold
 *   06–28f  logo reveal (scale 0.96 → 1, fade)
 *   14–34f  hairline draws in
 *   18–44f  show name fades up; words stagger; letter-spacing settles
 *   34–54f  episode line fades up
 *   78–90f  fade to black
 */
export const Intro: React.FC<IntroProps> = ({ branding, episode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const introDuration = 3 * fps;

  // Logo — subtle scale + fade.
  const logo = cardReveal(frame, fps, 6, 0.96);

  // Hairline accent — draws in beneath logo.
  const hairlineProgress = drawIn(frame, 14, TIMING.introLong);
  const hairlineOpacity = fadeUp(frame, fps, 14, 6).opacity;

  // Show name — word stagger + vertical drift + letter-spacing settle.
  const showWords = splitWords(branding.showName);
  const nameLetterSpacing = letterSpacingSettle(frame, 18, 0.08, -0.02);

  // Episode line — last to arrive.
  const episodeReveal = fadeUp(frame, fps, 34, 8);

  // Outro — clean fade to black at the very end.
  const fade = fadeOut(frame, introDuration - TIMING.fadeBlackOut, TIMING.fadeBlackOut);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        opacity: fade,
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial — grounds the composition without competing. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${branding.primaryColor}10 0%, ${COLORS.bg} 65%)`,
        }}
      />

      {/* Logo */}
      <div
        style={{
          opacity: logo.opacity,
          transform: `scale(${logo.scale})`,
          marginBottom: 28,
        }}
      >
        <Img
          src={branding.logoPath}
          style={{
            width: 96,
            height: 96,
            objectFit: 'contain',
          }}
        />
      </div>

      {/* Show name — word-staggered, letter-spacing settles. */}
      <div
        style={{
          color: COLORS.textPrimary,
          fontSize: 58,
          fontWeight: 700,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: nameLetterSpacing,
          textAlign: 'center',
          lineHeight: 1.1,
          maxWidth: '70%',
        }}
      >
        {showWords.map((word, i) => (
          <span
            key={i}
            style={{
              ...wordStaggerStyle(frame, fps, i, 18, TIMING.staggerWord, 12),
              marginRight: i === showWords.length - 1 ? 0 : '0.32em',
            }}
          >
            {word}
          </span>
        ))}
      </div>

      {/* Hairline accent */}
      <div
        style={{
          width: 200,
          height: 1,
          backgroundColor: COLORS.hairline,
          margin: '24px 0 18px',
          overflow: 'hidden',
          opacity: hairlineOpacity,
        }}
      >
        <div
          style={{
            width: `${hairlineProgress * 100}%`,
            height: '100%',
            backgroundColor: branding.primaryColor,
          }}
        />
      </div>

      {/* Episode marker — quiet, restrained. */}
      <div
        style={{
          opacity: episodeReveal.opacity,
          transform: `translateY(${episodeReveal.y}px)`,
          color: COLORS.textTertiary,
          fontSize: 13,
          fontWeight: 500,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.42em',
          textTransform: 'uppercase',
          paddingLeft: '0.42em', // optical balance for tracked uppercase
        }}
      >
        Episode · {episode.number}
      </div>

      {/* Vignette — texture only, never theatrical. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
