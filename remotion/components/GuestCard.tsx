import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { GuestProp, ResolvedBranding, MotionProp } from '../types';
import {
  EASE_EXPO_OUT,
  SPRING_TIGHT,
  fadeIn,
  fadeUp,
} from './utils/animations';

interface GuestCardProps {
  guest: GuestProp;
  branding: ResolvedBranding;
  motion: MotionProp;
}

/**
 * Scene 2 — Broadcast guest introduction slate. Theme-driven.
 */
export const GuestCard: React.FC<GuestCardProps> = ({
  guest,
  branding,
  motion,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const guestCardDuration = 5 * fps; // 150f

  const { colors, fonts, copy } = branding;

  // ─── Scene entrance + exit ──────────────────────────────────────────────
  const sceneIn = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const sceneOut = interpolate(
    frame,
    [guestCardDuration - 16, guestCardDuration],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_EXPO_OUT }
  );
  const sceneOpacity = Math.min(sceneIn, sceneOut);

  // ─── Brush stroke nameplate sweep ───────────────────────────────────────
  const brushProgress = interpolate(frame, [12, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const brushOpacity = fadeIn(frame, 12, 10);

  // ─── Guest photo slides in from right ───────────────────────────────────
  const photoSpring = spring({
    frame: frame - 20,
    fps,
    config: SPRING_TIGHT,
    from: 1,
    to: 0,
    durationInFrames: 24,
  });
  const photoX = photoSpring * 360;
  const photoOpacity = fadeIn(frame, 20, 14);

  // ─── Shutter flash ──────────────────────────────────────────────────────
  const shutterStart = 38;
  const shutterOpacity = interpolate(
    frame,
    [
      shutterStart,      shutterStart + 1.5, shutterStart + 3,
      shutterStart + 4.5, shutterStart + 6,  shutterStart + 7.5,
      shutterStart + 9,  shutterStart + 10.5,
    ],
    [0, 0.55, 0, 0.5, 0, 0.45, 0, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // ─── Warm color grade ───────────────────────────────────────────────────
  const warmGradeOpacity = interpolate(frame, [48, 68], [0, 0.32], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const warmTint = colorGradeTint(motion.colorGrade, colors.primary);

  // ─── Typography reveals ─────────────────────────────────────────────────
  const name    = fadeUp(frame, fps, 48, 18);
  const title   = fadeUp(frame, fps, 62, 14);
  const company = fadeUp(frame, fps, 74, 12);
  const handle  = fadeUp(frame, fps, 84, 10);

  // ─── Watermark ──────────────────────────────────────────────────────────
  const watermarkOpacity = fadeIn(frame, 18, 18);

  return (
    <AbsoluteFill
      style={{
        opacity: sceneOpacity,
        backgroundColor: colors.navy,
        overflow: 'hidden',
      }}
    >
      {/* Animated grain texture */}
      <AbsoluteFill
        style={{
          backgroundImage: `url("${GRAIN_DATA_URI}")`,
          backgroundSize: '220px 220px',
          opacity: 0.18,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />

      {/* Subtle brand-primary glow for depth */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 30% 65%, ${colors.primary}1f 0%, ${colors.navy} 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Brush-stroke nameplate */}
      <div
        style={{
          position: 'absolute',
          left: '6%',
          bottom: '20%',
          width: '58%',
          height: 4,
          backgroundColor: colors.primary,
          opacity: brushOpacity,
          clipPath: `inset(0 ${(1 - brushProgress) * 100}% 0 0)`,
          transformOrigin: 'left center',
          boxShadow: `0 0 24px ${colors.primary}66`,
        }}
      />

      {/* Secondary thin stroke */}
      <div
        style={{
          position: 'absolute',
          left: '6%',
          bottom: 'calc(20% + 12px)',
          width: '36%',
          height: 1,
          backgroundColor: `${colors.primary}80`,
          opacity: brushOpacity,
          clipPath: `inset(0 ${(1 - Math.max(0, brushProgress - 0.2) / 0.8) * 100}% 0 0)`,
        }}
      />

      {/* Guest photo */}
      <div
        style={{
          position: 'absolute',
          right: '8%',
          top: '50%',
          transform: `translate(${photoX}px, -50%)`,
          opacity: photoOpacity,
          width: 360,
          height: 460,
          borderRadius: 22,
          overflow: 'hidden',
          boxShadow: `0 30px 60px rgba(0,0,0,0.55), 0 0 0 1px ${colors.primary}40`,
        }}
      >
        <Img
          src={guest.photoPath}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* Warm color grade overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: warmTint,
            opacity: warmGradeOpacity,
            mixBlendMode: 'overlay',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.5) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* INTRODUCING eyebrow */}
      <div
        style={{
          position: 'absolute',
          left: '6%',
          bottom: 'calc(20% + 220px)',
          opacity: brushOpacity,
          color: colors.primary,
          fontFamily: fonts.body,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.42em',
          textTransform: 'uppercase',
          paddingLeft: '0.42em',
        }}
      >
        {copy.introducing}
      </div>

      {/* Guest name */}
      <div
        style={{
          position: 'absolute',
          left: '6%',
          bottom: 'calc(20% + 90px)',
          opacity: name.opacity,
          transform: `translateY(${name.y + 4}px)`,
          color: colors.textCream,
          fontFamily: fonts.display,
          fontSize: 64,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          lineHeight: 1.0,
          whiteSpace: 'nowrap',
        }}
      >
        {guest.name}
      </div>

      {/* Title */}
      <div
        style={{
          position: 'absolute',
          left: '6%',
          bottom: 'calc(20% - 42px)',
          opacity: title.opacity,
          transform: `translateY(${title.y}px)`,
          color: colors.primary,
          fontFamily: fonts.body,
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {guest.title}
      </div>

      {/* Company */}
      <div
        style={{
          position: 'absolute',
          left: '6%',
          bottom: 'calc(20% - 78px)',
          opacity: company.opacity * 0.7,
          transform: `translateY(${company.y}px)`,
          color: colors.textCream,
          fontFamily: fonts.body,
          fontSize: 18,
          fontWeight: 300,
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
        }}
      >
        {guest.company}
      </div>

      {/* LinkedIn handle */}
      {guest.linkedIn && (
        <div
          style={{
            position: 'absolute',
            left: '6%',
            bottom: 'calc(20% - 116px)',
            opacity: handle.opacity,
            transform: `translateY(${handle.y}px)`,
            color: colors.textCreamDim,
            fontFamily: fonts.body,
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.06em',
          }}
        >
          {copy.linkedInPrefix}{guest.linkedIn}
        </div>
      )}

      {/* Corner watermark — hidden if copy.watermark is empty string */}
      {copy.watermark && (
        <div
          style={{
            position: 'absolute',
            top: 28,
            right: 36,
            opacity: watermarkOpacity * 0.55,
            color: colors.textCream,
            fontFamily: fonts.body,
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.18em',
          }}
        >
          {copy.watermark}
        </div>
      )}

      {/* Camera shutter flashes */}
      <AbsoluteFill
        style={{
          backgroundColor: '#ffffff',
          opacity: shutterOpacity,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Helpers ───────────────────────────────────────────────────────────────

const colorGradeTint = (
  grade: MotionProp['colorGrade'],
  brandPrimary: string
): string => {
  switch (grade) {
    case 'warm':
      return `linear-gradient(135deg, ${brandPrimary}cc 0%, #c97a1f80 100%)`;
    case 'cool':
      return 'linear-gradient(135deg, #3b6fcccc 0%, #0d1f4180 100%)';
    case 'neutral':
    default:
      return 'linear-gradient(135deg, rgba(255,240,220,0.6) 0%, rgba(40,40,40,0.4) 100%)';
  }
};

const GRAIN_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">` +
  `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>` +
  `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.7 0"/></filter>` +
  `<rect width="100%" height="100%" filter="url(#n)" opacity="0.6"/></svg>`;
const GRAIN_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}`;
