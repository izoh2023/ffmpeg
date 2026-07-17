import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from 'remotion';
import { ResolvedBranding, EpisodeProp, MotionProp } from '../types';
import {
  EASE_EXPO_OUT,
  colorGradeTint,
  fadeIn,
  fadeOut,
  fadeUp,
  logoSlam,
  typewriterChars,
} from './utils/animations';
import { CinematicBars } from './CinematicBars';

interface IntroProps {
  branding: ResolvedBranding;
  episode: EpisodeProp;
  motion: MotionProp;
}

/**
 * Scene 1 — Logo entrance + show-name typewriter.
 * All colors / fonts / copy come from `branding` props (theme-driven).
 */
export const Intro: React.FC<IntroProps> = ({ branding, episode, motion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const introDuration = 4 * fps; // 120f

  const { colors, fonts, copy } = branding;

  // ─── Logo slam ──────────────────────────────────────────────────────────
  const logo = logoSlam(frame, fps, 4, 7.0);

  // ─── Radial light sweep across the logo ─────────────────────────────────
  const sweepRotation = interpolate(frame, [18, 38], [0, 360], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sweepOpacity = interpolate(frame, [18, 22, 34, 38], [0, 0.18, 0.18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // ─── Show name typewriter ───────────────────────────────────────────────
  const TYPE_START = 34;
  const FRAMES_PER_CHAR = 3;
  const visibleChars = typewriterChars(frame, branding.showName.length, TYPE_START, FRAMES_PER_CHAR);
  const typedText = branding.showName.slice(0, visibleChars);
  const typingDone = visibleChars >= branding.showName.length;
  const typingDoneAt = TYPE_START + branding.showName.length * FRAMES_PER_CHAR;
  const cursorBlink = Math.floor((frame - TYPE_START) / 10) % 2 === 0;
  const cursorVisible = frame >= TYPE_START
    && (!typingDone || (typingDone && frame < typingDoneAt + 24 && cursorBlink));

  const typeBlockOpacity = fadeIn(frame, TYPE_START, 6);
  const hostReveal      = fadeUp(frame, fps, 58, 10);
  const episodeReveal   = fadeUp(frame, fps, 38, 8);

  const smashCut = fadeOut(frame, introDuration - 14, 14);
  const vignetteOpacity = fadeIn(frame, 0, 30);

  // ─── Color grade wash — same treatment as every other scene ─────────────
  const gradeOpacity = interpolate(frame, [40, 70], [0, 0.2], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const gradeTint = colorGradeTint(motion.colorGrade, colors.primary);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000000', // the *one* pure-black moment in the trailer
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        opacity: smashCut,
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial — tinted by the brand primary */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${colors.primary}14 0%, #000 70%)`,
          opacity: vignetteOpacity,
        }}
      />

      {/* Logo + sweep */}
      <div
        style={{
          position: 'relative',
          width: 220,
          height: 220,
          marginBottom: 38,
          opacity: logo.opacity,
          transform: `scale(${logo.scale})`,
          filter: `blur(${logo.blurPx}px)`,
          willChange: 'transform, filter',
        }}
      >
        <Img
          src={branding.logoPath}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: -20,
            borderRadius: '50%',
            background: `conic-gradient(from ${sweepRotation}deg,
                          transparent 0deg,
                          rgba(255,255,255,0.85) 40deg,
                          transparent 90deg,
                          transparent 360deg)`,
            mixBlendMode: 'screen',
            opacity: sweepOpacity,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Episode marker eyebrow */}
      <div
        style={{
          opacity: episodeReveal.opacity,
          transform: `translateY(${episodeReveal.y}px)`,
          color: colors.primary,
          fontFamily: fonts.body,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.42em',
          textTransform: 'uppercase',
          marginBottom: 18,
          paddingLeft: '0.42em',
        }}
      >
        {copy.episodePrefix} {episode.number}
      </div>

      {/* Show name — typewriter */}
      <div
        style={{
          opacity: typeBlockOpacity,
          color: colors.textCream,
          fontFamily: fonts.display,
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: '0',
          textAlign: 'center',
          lineHeight: 1.05,
          display: 'flex',
          alignItems: 'baseline',
          minHeight: 80,
        }}
      >
        <span>{typedText}</span>
        <span
          style={{
            display: 'inline-block',
            width: 4,
            height: '0.82em',
            marginLeft: 6,
            background: colors.primary,
            opacity: cursorVisible ? 1 : 0,
            transform: 'translateY(0.06em)',
          }}
        />
      </div>

      {/* Host slate (optional) */}
      {branding.hostName && (
        <div
          style={{
            opacity: hostReveal.opacity,
            transform: `translateY(${hostReveal.y}px)`,
            color: colors.textCreamDim,
            fontFamily: fonts.body,
            fontSize: 14,
            fontWeight: 400,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            marginTop: 28,
            paddingLeft: '0.32em',
          }}
        >
          {copy.withHost} {branding.hostName}
        </div>
      )}

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.7) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Color grade wash */}
      <AbsoluteFill
        style={{
          background: gradeTint,
          opacity: gradeOpacity,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />

      {motion.energy === 'cinematic' && <CinematicBars delay={10} />}

      {/* Brand-colored bloom on the slam landing (hype only) */}
      {motion.energy === 'hype' && (
        <AbsoluteFill
          style={{
            background:
              `radial-gradient(ellipse at center, ${colors.primary}55 0%, transparent 60%)`,
            opacity: interpolate(frame, [26, 32, 44], [0, 0.55, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: EASE_EXPO_OUT,
            }),
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />
      )}
    </AbsoluteFill>
  );
};
