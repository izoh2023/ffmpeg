import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Video,
  Img,
} from 'remotion';
import { ClipProp, ResolvedBranding, GuestProp, MotionProp } from '../types';
import { EASE_EXPO_OUT, colorGradeTint, flashCut, zoomPush } from './utils/animations';
import { CinematicBars } from './CinematicBars';

interface ClipSegmentProps {
  clip: ClipProp;
  guest: GuestProp;
  branding: ResolvedBranding;
  motion: MotionProp;
  clipIndex: number;
  totalClips: number;
  /** First clip in the sequence — gets the broadcast-style guest attribution. */
  isFirst?: boolean;
  /** Which side the host name sits on (guest takes the other side). */
  hostSide?: 'left' | 'right';
}

/**
 * Clip segment — full-bleed video with animated host/guest name tags in the
 * bottom corners. Theme-driven; colors/fonts/clip-prefix come from
 * props.branding. Because each clip is its own Sequence, the name tags
 * naturally re-animate in on every clip (frame resets to 0 per Sequence).
 */
export const ClipSegment: React.FC<ClipSegmentProps> = ({
  clip,
  guest,
  branding,
  motion,
  clipIndex,
  hostSide = 'left',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clipDuration = Math.round(clip.duration * fps);

  const { colors, fonts } = branding;

  const sceneIn = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const sceneOut = interpolate(frame, [clipDuration - 14, clipDuration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const opacity = Math.min(sceneIn, sceneOut);

  // Audio ducks out just ahead of the visual cut instead of hard-stopping
  // at the Sequence boundary, so clip-to-transition cuts don't pop.
  const audioIn = interpolate(frame, [0, 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const audioOut = interpolate(frame, [clipDuration - 10, clipDuration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const volume = Math.min(audioIn, audioOut);

  // Zoom intensity follows the energy setting — hype pushes hardest,
  // cinematic stays composed, calm barely moves.
  const zoomTarget =
    motion.energy === 'cinematic' ? 1.03 : motion.energy === 'calm' ? 1.015 : 1.05;
  const ZOOM_START = clipDuration - 10;
  const zoom = zoomPush(frame, ZOOM_START, 10, zoomTarget);

  // Color grade wash — same gradient/overlay treatment as every other scene.
  const gradeOpacity = interpolate(frame, [10, 30], [0, 0.22], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const gradeTint = colorGradeTint(motion.colorGrade, colors.primary);

  // Flash-cut spike at the tail — bridges the hard cut into the next
  // Transition (which mirrors this at its own frame 0).
  const FLASH_DURATION = 8;
  const cutFlash = flashCut(frame, clipDuration - FLASH_DURATION, 0.8, FLASH_DURATION);

  const barProgress = interpolate(frame, [14, 32], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const nameOpacity = interpolate(frame, [18, 36], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const nameY = interpolate(frame, [18, 36], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const showSoftWash = motion.energy === 'hype' && clipIndex > 0;
  const softWashOpacity = interpolate(frame, [0, 4, 12], [0.32, 0.14, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const cornerOpacity = interpolate(frame, [26, 40], [0, 0.45], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const hostName = branding.hostName;
  const guestName = guest.name;
  const leftName = hostSide === 'left' ? hostName : guestName;
  const rightName = hostSide === 'left' ? guestName : hostName;

  const renderNameTag = (name: string | undefined, side: 'left' | 'right') => {
    if (!name) return null;
    const isLeft = side === 'left';
    return (
      <div
        style={{
          position: 'absolute',
          bottom: 56,
          [isLeft ? 'left' : 'right']: 72,
          display: 'flex',
          flexDirection: isLeft ? 'row' : 'row-reverse',
          alignItems: 'stretch',
          gap: 14,
          opacity: nameOpacity,
          transform: `translateY(${nameY}px)`,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 3,
            minHeight: 30,
            backgroundColor: colors.primary,
            transform: `scaleY(${barProgress})`,
            transformOrigin: 'top center',
            boxShadow: `0 0 10px ${colors.primary}88`,
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            color: colors.textCream,
            fontFamily: fonts.body,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '0.01em',
            textAlign: isLeft ? 'left' : 'right',
          }}
        >
          {name}
        </div>
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor: colors.backgroundDeep, overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity }}>
        <AbsoluteFill
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <Video
            src={clip.videoPath}
            volume={volume}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>

        {/* Color grade wash */}
        <AbsoluteFill
          style={{
            background: gradeTint,
            opacity: gradeOpacity,
            mixBlendMode: 'overlay',
            pointerEvents: 'none',
          }}
        />

        {/* Bottom scrim */}
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 22%, transparent 42%)',
            pointerEvents: 'none',
          }}
        />

        {motion.energy === 'cinematic' && <CinematicBars />}

        {/* Host / guest name tags */}
        {renderNameTag(leftName, 'left')}
        {renderNameTag(rightName, 'right')}

        {/* Corner logo */}
        {branding.logoPath && (
          <div
            style={{
              position: 'absolute',
              top: 28,
              right: 36,
              width: 40,
              height: 40,
              opacity: cornerOpacity,
            }}
          >
            <Img
              src={branding.logoPath}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        )}

        {/* Hype-only soft brand wash */}
        {showSoftWash && (
          <AbsoluteFill
            style={{
              background:
                `radial-gradient(ellipse at center, ${colors.primary}55 0%, transparent 70%)`,
              opacity: softWashOpacity,
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />
        )}
      </AbsoluteFill>

      {/* Flash-cut spike into the next Transition — independent of the
          scene's own fade-out so it stays punchy right up to the cut. */}
      <AbsoluteFill
        style={{
          backgroundColor: colors.primary,
          opacity: cutFlash,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
