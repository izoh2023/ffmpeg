import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Video,
} from 'remotion';
import { ClipProp, BrandingProp, GuestProp } from '../types';
import {
  COLORS,
  TIMING,
  fadeIn,
  fadeOut,
  fadeUp,
  drawIn,
} from './utils/animations';

interface ClipSegmentProps {
  clip: ClipProp;
  guest: GuestProp;
  branding: BrandingProp;
  isFirst: boolean;
}

/**
 * Talking-head clip segment.
 *
 * Beats:
 *   00–14f    clean fade in (no zoom punch, no flash)
 *   isFirst:
 *     14–34f  vertical accent grows
 *     18–38f  guest name fades up
 *     26–46f  guest title/company fades up
 *     ── lower third holds for the full clip ──
 *   end-12f   scene fades out (lower third goes with it)
 */
export const ClipSegment: React.FC<ClipSegmentProps> = ({
  clip,
  guest,
  branding,
  isFirst,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clipDuration = clip.duration * fps;

  // Scene-level fade in / out — no transform, no scale punch.
  const sceneIn = fadeIn(frame, 0, TIMING.intro - 8); // ~14f
  const sceneOut = fadeOut(frame, clipDuration - TIMING.fadeBlackOut, TIMING.fadeBlackOut);
  const opacity = Math.min(sceneIn, sceneOut);

  // Vignette — settles in once, holds.
  const vignetteOpacity = fadeIn(frame, 0, TIMING.intro);

  // Lower third (first clip only). Holds for the full clip — only fades with the
  // scene-level `opacity` above. The viewer needs time to read the name + title.
  const accentProgress = drawIn(frame, 14, 22);

  const name = fadeUp(frame, fps, 18, 12);
  const sub = fadeUp(frame, fps, 26, 10);

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundColor: COLORS.bgDeep,
        overflow: 'hidden',
      }}
    >
      {/* Video — full bleed, untouched by scale punches. */}
      <AbsoluteFill>
        <Video
          src={clip.videoPath}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </AbsoluteFill>

      {/* Vignette — texture, never theatrical. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.55) 100%)',
          opacity: vignetteOpacity,
          pointerEvents: 'none',
        }}
      />

      {isFirst && (
        <>
          {/* Bottom scrim — only behind the lower third. */}
          <AbsoluteFill
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 22%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />

          <AbsoluteFill
            style={{
              justifyContent: 'flex-end',
              alignItems: 'flex-start',
              padding: '0 80px 72px 80px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 18,
              }}
            >
              {/* Vertical accent — grows downward from the top. */}
              <div
                style={{
                  width: 2,
                  height: 64,
                  marginTop: 8,
                  flexShrink: 0,
                  backgroundColor: COLORS.hairline,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${accentProgress * 100}%`,
                    backgroundColor: branding.primaryColor,
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Name */}
                <div
                  style={{
                    opacity: name.opacity,
                    transform: `translateY(${name.y}px)`,
                    color: COLORS.textPrimary,
                    fontSize: 36,
                    fontWeight: 600,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '-0.01em',
                    lineHeight: 1.1,
                  }}
                >
                  {guest.name}
                </div>

                {/* Title · Company */}
                <div
                  style={{
                    opacity: sub.opacity,
                    transform: `translateY(${sub.y}px)`,
                    color: COLORS.textSecondary,
                    fontSize: 18,
                    fontWeight: 500,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '0.02em',
                    marginTop: 8,
                  }}
                >
                  <span style={{ color: branding.primaryColor }}>{guest.title}</span>
                  <span style={{ opacity: 0.5, margin: '0 0.5em' }}>·</span>
                  <span>{guest.company}</span>
                </div>
              </div>
            </div>
          </AbsoluteFill>
        </>
      )}
    </AbsoluteFill>
  );
};
