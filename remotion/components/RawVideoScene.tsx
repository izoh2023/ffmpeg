import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Video,
} from 'remotion';
import { EASE_EXPO_OUT } from './utils/animations';

interface RawVideoSceneProps {
  videoPath: string;
  durationInFrames: number;
}

/**
 * Full-bleed video, used when a client supplies their own intro/outro file
 * instead of the built-in animated scene. Fades match the other scenes'
 * scene-edge crossfade so the cut in/out still feels intentional.
 */
export const RawVideoScene: React.FC<RawVideoSceneProps> = ({ videoPath, durationInFrames }) => {
  const frame = useCurrentFrame();

  const sceneIn = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const sceneOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const opacity = Math.min(sceneIn, sceneOut);

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: '#000000' }}>
      <Video src={videoPath} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
};
