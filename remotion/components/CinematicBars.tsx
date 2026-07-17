import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { EASE_EXPO_OUT } from './utils/animations';

interface CinematicBarsProps {
  /** Height of each bar as a percentage of frame height. */
  heightPct?: number;
  delay?: number;
}

/**
 * Top/bottom letterbox bars — used when `motion.energy === 'cinematic'` on
 * scenes that show real footage (Intro logo card, ClipSegment) to read as a
 * widescreen "film" moment rather than a broadcast graphic.
 */
export const CinematicBars: React.FC<CinematicBarsProps> = ({
  heightPct = 7,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [delay, delay + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const barStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    height: `${heightPct}%`,
    backgroundColor: '#000000',
    opacity,
    pointerEvents: 'none',
  };

  return (
    <>
      <div style={{ ...barStyle, top: 0 }} />
      <div style={{ ...barStyle, bottom: 0 }} />
    </>
  );
};
