import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ResolvedBranding } from '../types';
import { EASE_EXPO_OUT } from './utils/animations';

interface TeaseCardProps {
  text: string;
  branding: ResolvedBranding;
}

/**
 * Short kinetic bridge card (~1.4s). Currently unused by the trailer timeline
 * — kept available for future flows that need a text-only beat. Theme-driven.
 */
export const TeaseCard: React.FC<TeaseCardProps> = ({ text, branding }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const TOTAL = Math.round(1.4 * fps); // 42f

  const { colors, fonts } = branding;

  const sceneIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const sceneOut = interpolate(frame, [TOTAL - 14, TOTAL], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const sceneOpacity = Math.min(sceneIn, sceneOut);

  const textOpacity = interpolate(frame, [6, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const textY = interpolate(frame, [6, 18], [12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const underlineProgress = interpolate(frame, [10, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.cutBackground,
        opacity: sceneOpacity,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '0 10%',
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${colors.primary}10 0%, ${colors.cutBackground} 65%)`,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          opacity: textOpacity,
          transform: `translateY(${textY}px)`,
          color: colors.textCream,
          fontFamily: fonts.display,
          fontSize: 46,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          textAlign: 'center',
          lineHeight: 1.18,
        }}
      >
        {text}
      </div>

      <div
        style={{
          marginTop: 22,
          width: 56,
          height: 2,
          backgroundColor: colors.primary,
          boxShadow: `0 0 10px ${colors.primary}55`,
          opacity: underlineProgress,
          clipPath: `inset(0 ${(1 - underlineProgress) * 100}% 0 0)`,
        }}
      />
    </AbsoluteFill>
  );
};
