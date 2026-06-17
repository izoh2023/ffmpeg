import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from 'remotion';
import { ResolvedBranding, EpisodeProp } from '../types';
import {
  EASE_EXPO_OUT,
  SPRING_TIGHT,
  fadeUp,
} from './utils/animations';

interface OutroProps {
  branding: ResolvedBranding;
  episode: EpisodeProp;
  musicPath: string;
}

/**
 * Scene 5 — Episode card + CTA. Theme-driven.
 *
 * Background is `colors.primary` full-bleed (gold by default), title is
 * `colors.textNavy`, pill uses `colors.navy` + `colors.textCream`.
 * "Coming Soon"-style CTA copy comes from `copy.availableNow` (but the
 * pill itself shows `episode.number` — e.g. "Coming Soon").
 */
export const Outro: React.FC<OutroProps> = ({ branding, episode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outroDuration = 7 * fps; // 210f

  const { colors, fonts } = branding;

  // Scene fades
  const sceneIn = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const sceneOut = interpolate(
    frame,
    [outroDuration - 36, outroDuration],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_EXPO_OUT }
  );
  const sceneOpacity = Math.min(sceneIn, sceneOut);

  // Background brightness pulse
  const bgPulse = 1 + 0.04 * Math.sin((frame / fps) * 0.9 * Math.PI);

  // Title slides down from above
  const titleSpring = spring({
    frame: frame - 10,
    fps,
    config: SPRING_TIGHT,
    from: -90,
    to: 0,
    durationInFrames: 32,
  });
  const titleOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  // Pill rises + straightens
  const pillAppear = spring({
    frame: frame - 38,
    fps,
    config: SPRING_TIGHT,
    from: 0,
    to: 1,
    durationInFrames: 20,
  });
  const pillStraighten = spring({
    frame: frame - 46,
    fps,
    config: SPRING_TIGHT,
    from: 1,
    to: 0,
    durationInFrames: 28,
  });
  const pillRotation = pillStraighten * -5;
  const pillScale = pillAppear;
  const pillOpacity = interpolate(frame, [38, 52], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const tagline = fadeUp(frame, fps, 58, 14);
  const logoReveal     = fadeUp(frame, fps, 70, 12);
  const showNameReveal = fadeUp(frame, fps, 76, 12);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.primary,
        opacity: sceneOpacity,
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial darker corners — uses brand navy tint */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 40%, ${colors.navy}30 100%)`,
          pointerEvents: 'none',
          opacity: bgPulse - 0.96,
        }}
      />

      {/* Quiet diagonal sheen */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(125deg, rgba(255,255,255,0.08) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.06) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Episode title (sits on the gold) */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          padding: '0 8%',
        }}
      >
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${titleSpring}px)`,
            color: colors.textNavy,
            fontFamily: fonts.display,
            fontSize: 78,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            lineHeight: 1.05,
            marginBottom: 36,
          }}
        >
          {episode.title}
        </div>

        {/* CTA pill — episode.number drives the text */}
        <div
          style={{
            opacity: pillOpacity,
            transform: `scale(${pillScale}) rotate(${pillRotation}deg)`,
            transformOrigin: 'center center',
            backgroundColor: colors.navy,
            color: colors.textCream,
            fontFamily: fonts.body,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            padding: '12px 28px',
            paddingLeft: '32px',
            borderRadius: 999,
            boxShadow: `0 12px 24px ${colors.navy}40`,
          }}
        >
          {episode.number}
        </div>

        {/* Tagline (optional) */}
        {branding.tagline && (
          <div
            style={{
              opacity: tagline.opacity * 0.85,
              transform: `translateY(${tagline.y}px)`,
              marginTop: 28,
              color: colors.textNavy,
              fontFamily: fonts.body,
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textAlign: 'center',
            }}
          >
            {branding.tagline}
          </div>
        )}
      </AbsoluteFill>

      {/* Bottom: logo + show name */}
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            opacity: logoReveal.opacity,
            transform: `translateY(${logoReveal.y}px)`,
            width: 38,
            height: 38,
          }}
        >
          <Img
            src={branding.logoPath}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
        <div
          style={{
            opacity: showNameReveal.opacity,
            transform: `translateY(${showNameReveal.y}px)`,
            color: colors.textNavy,
            fontFamily: fonts.body,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
          }}
        >
          {branding.showName}
        </div>
      </div>
    </AbsoluteFill>
  );
};
