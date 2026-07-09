import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Video,
} from 'remotion';
import { ClipProp, ResolvedBranding, GuestProp, MotionProp } from '../types';
import { EASE_EXPO_OUT, zoomPush, beatPulse } from './utils/animations';

interface ClipSegmentProps {
  clip: ClipProp;
  guest: GuestProp;
  branding: ResolvedBranding;
  motion: MotionProp;
  clipIndex: number;
  totalClips: number;
  /** First clip in the sequence — gets the broadcast-style guest attribution. */
  isFirst?: boolean;
  /** Beat frames (local to this clip's Sequence) to punch/flash on. */
  beatFrames?: number[];
}

/**
 * Clip segment — full-bleed video with a smooth lower third.
 * Theme-driven; colors/fonts/clip-prefix come from props.branding.
 */
export const ClipSegment: React.FC<ClipSegmentProps> = ({
  clip,
  guest,
  branding,
  motion,
  clipIndex,
  isFirst = false,
  beatFrames = [],
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clipDuration = Math.round(clip.duration * fps);

  const { colors, fonts, copy } = branding;

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

  const ZOOM_START = clipDuration - 10;
  const endZoom = zoomPush(frame, ZOOM_START, 10, 1.05);

  // Music-reactive punch-in: a quick, tiny extra scale bump on every beat so
  // the footage feels cut to the track rather than just laid under it.
  const beatPunch = beatPulse(frame, beatFrames, 2, 8);
  const zoom = endZoom * (1 + beatPunch * 0.012);

  const borderProgress = interpolate(frame, [14, 32], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  const titleX = interpolate(frame, [18, 36], [-18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const titleOpacity = interpolate(frame, [18, 36], [0, 1], {
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

  const lowerThirdText = clip.captionOverride ?? clip.title;

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundColor: colors.backgroundDeep,
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <Video
          src={clip.videoPath}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      {/* Bottom scrim */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 22%, transparent 42%)',
          pointerEvents: 'none',
        }}
      />

      {/* Lower third */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'flex-start',
          padding: '0 72px 56px 72px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            gap: 18,
          }}
        >
          <div
            style={{
              width: 3,
              minHeight: 64,
              backgroundColor: colors.primary,
              transform: `scaleY(${borderProgress})`,
              transformOrigin: 'top center',
              boxShadow: `0 0 ${10 + beatPunch * 14}px ${colors.primary}88`,
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              opacity: titleOpacity,
              transform: `translateX(${titleX}px)`,
            }}
          >
            <div
              style={{
                color: colors.textCream,
                fontFamily: fonts.body,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: '0.01em',
                lineHeight: 1.25,
                maxWidth: 740,
              }}
            >
              {lowerThirdText}
            </div>

            {isFirst && (
              <div
                style={{
                  color: colors.primary,
                  fontFamily: fonts.body,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  marginTop: 8,
                  paddingLeft: '0.18em',
                }}
              >
                {guest.name}
              </div>
            )}
          </div>
        </div>
      </AbsoluteFill>

      {/* Corner marker */}
      <div
        style={{
          position: 'absolute',
          top: 28,
          right: 36,
          opacity: cornerOpacity,
          color: colors.textCream,
          fontFamily: fonts.body,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.32em',
        }}
      >
        {copy.clipPrefix} {String(clipIndex + 1).padStart(2, '0')}
      </div>

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

      {/* Beat flash — a faint white lift on every beat, felt more than seen. */}
      <AbsoluteFill
        style={{
          backgroundColor: '#ffffff',
          opacity: beatPunch * 0.05,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
