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

interface OutroProps {
  branding: BrandingProp;
  episode: EpisodeProp;
  musicPath: string;
}

/**
 * Outro card.
 *
 * Beats:
 *   00–08f    fade in from black
 *   06–32f    logo reveals (scale 0.96 → 1, fade)
 *   18–44f    show name fades up (word stagger, letter-spacing settle)
 *   28–50f    hairline accent draws in
 *   38–60f    episode title fades up
 *   54–74f    "Available now" fades up — no looping pulse
 *   end-15f   fade out
 */
export const Outro: React.FC<OutroProps> = ({ branding, episode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outroDuration = 4 * fps;

  // Scene fade in/out.
  const fadeInOpacity = fadeUp(frame, fps, 0, 0).opacity;
  const fade = fadeOut(frame, outroDuration - 15, 15);
  const sceneOpacity = Math.min(fadeInOpacity, fade);

  // Logo
  const logo = cardReveal(frame, fps, 6, 0.96);

  // Show name (word-staggered)
  const showWords = splitWords(branding.showName);
  const nameLetterSpacing = letterSpacingSettle(frame, 18, 0.08, -0.02);

  // Hairline rule
  const ruleProgress = drawIn(frame, 28, TIMING.introLong);
  const ruleOpacity = fadeUp(frame, fps, 28, 6).opacity;

  // Episode title and CTA
  const title = fadeUp(frame, fps, 38, 12);
  const cta = fadeUp(frame, fps, 54, 8);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        opacity: sceneOpacity,
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial */}
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
          marginBottom: 26,
        }}
      >
        <Img
          src={branding.logoPath}
          style={{ width: 90, height: 90, objectFit: 'contain' }}
        />
      </div>

      {/* Show name */}
      <div
        style={{
          color: COLORS.textPrimary,
          fontSize: 54,
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

      {/* Hairline rule */}
      <div
        style={{
          width: 200,
          height: 1,
          backgroundColor: COLORS.hairline,
          margin: '24px 0 22px',
          overflow: 'hidden',
          opacity: ruleOpacity,
        }}
      >
        <div
          style={{
            width: `${ruleProgress * 100}%`,
            height: '100%',
            backgroundColor: branding.primaryColor,
          }}
        />
      </div>

      {/* Episode title */}
      <div
        style={{
          opacity: title.opacity,
          transform: `translateY(${title.y}px)`,
          color: COLORS.textSecondary,
          fontSize: 22,
          fontWeight: 400,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.005em',
          textAlign: 'center',
          maxWidth: '60%',
          lineHeight: 1.4,
          marginBottom: 28,
        }}
      >
        {episode.title}
      </div>

      {/* Available now — clean fade-up only, no pulsing. */}
      <div
        style={{
          opacity: cta.opacity,
          transform: `translateY(${cta.y}px)`,
          color: branding.primaryColor,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.42em',
          textTransform: 'uppercase',
          paddingLeft: '0.42em',
        }}
      >
        Available Now
      </div>

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
