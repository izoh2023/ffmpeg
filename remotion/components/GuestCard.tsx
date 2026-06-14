import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Video,
} from 'remotion';
import { GuestProp, BrandingProp, ClipProp } from '../types';
import {
  COLORS,
  TIMING,
  SPRING_SETTLE,
  fadeIn,
  fadeOut,
  fadeUp,
  letterSpacingSettle,
  kenBurns,
  drawIn,
} from './utils/animations';

interface GuestCardProps {
  guest: GuestProp;
  branding: BrandingProp;
  firstClip: ClipProp;
}

/**
 * Guest reveal card — a two-act, "pulling-focus" reveal.
 *
 *   ── Act I — Hero (frames 0–55) ────────────────────────────────────
 *   The clip is heavily blurred and dimmed. The guest name sits
 *   centered, large, with letter-spacing settling on arrival.
 *
 *   ── Act II — Settle (frames 55–82) ─────────────────────────────────
 *   Blur and scrim ease away as the name drifts from screen-center
 *   down to the lower-third position and shrinks to caption size.
 *
 *   ── Act III — Lower third (frames 78–end) ──────────────────────────
 *   Vertical accent grows beside the settled name. Title and company
 *   fade up beneath. Holds. Final 12 frames fade to black.
 *
 * All lower-third elements (name in its settled state, accent rule,
 * title, company) share a single coordinate system anchored to the
 * canvas, so they align regardless of the name string's length.
 */

// ─── Lower-third geometry (% of 1920×1080 canvas) ─────────────────────────────
//   These are the resting positions. The name interpolates from the hero
//   centerpoint to NAME_SETTLED, while title/company stay anchored.
const LT = {
  leftPad:        7.3,   // 5% canvas pad + 22px accent + 22px gap, on 1920
  accentLeft:     5.0,
  nameTop:       78.0,
  titleTop:      86.5,
  companyTop:    90.0,
  accentTop:     78.0,
  accentHeight:  80,     // px
};

export const GuestCard: React.FC<GuestCardProps> = ({
  guest,
  branding,
  firstClip,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const guestCardDuration = 4 * fps;

  // ─── Beats ────────────────────────────────────────────────────────────────
  const HERO_HOLD   = 55;
  const SETTLE_DUR  = 26;
  const SETTLE_END  = HERO_HOLD + SETTLE_DUR;

  // ─── Reveal driver — single spring controls every coordinated change ─────
  // 0 = hero centered + heavy blur ; 1 = lower-third settled + cleared
  const reveal = spring({
    frame: frame - HERO_HOLD,
    fps,
    config: SPRING_SETTLE,
    durationInFrames: SETTLE_DUR,
    from: 0,
    to: 1,
  });

  // ─── Background — Ken Burns + blur/brightness easing alongside reveal ────
  const mediaScale = kenBurns(frame, guestCardDuration, 1.05, 1.0);
  const mediaOpacity = fadeIn(frame, 0, TIMING.intro);
  const blurPx     = interpolate(reveal, [0, 1], [18, 6],   { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const brightness = interpolate(reveal, [0, 1], [0.4, 0.62], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scrim      = interpolate(reveal, [0, 1], [0.7, 0.42], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // ─── Hero name entrance ──────────────────────────────────────────────────
  const nameEntrance = fadeUp(frame, fps, 4, 14);
  const nameLetterSpacing = letterSpacingSettle(frame, 4, 0.06, -0.02, TIMING.introLong);

  // ─── Hero → settled morph ────────────────────────────────────────────────
  const nameLeftPct  = interpolate(reveal, [0, 1], [50, LT.leftPad], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const nameTopPct   = interpolate(reveal, [0, 1], [50, LT.nameTop], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const nameTxPct    = interpolate(reveal, [0, 1], [-50, 0],         { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const nameTyPct    = interpolate(reveal, [0, 1], [-50, 0],         { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const nameFontSize = interpolate(reveal, [0, 1], [104, 68],        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // ─── Lower-third companions arrive after the name has settled ────────────
  const accentProgress = drawIn(frame, SETTLE_END - 4, 20);
  const accentOpacity  = fadeUp(frame, fps, SETTLE_END - 4, 0).opacity;
  const title   = fadeUp(frame, fps, SETTLE_END + 2, 10);
  const company = fadeUp(frame, fps, SETTLE_END + 10, 10);

  // ─── Outro ───────────────────────────────────────────────────────────────
  const fade = fadeOut(
    frame,
    guestCardDuration - TIMING.fadeBlackOut,
    TIMING.fadeBlackOut
  );

  return (
    <AbsoluteFill
      style={{
        opacity: fade,
        backgroundColor: COLORS.bg,
        overflow: 'hidden',
      }}
    >
      {/* Background video — softens to reveal as the name settles. */}
      <AbsoluteFill
        style={{
          opacity: mediaOpacity,
          transform: `scale(${mediaScale})`,
          transformOrigin: 'center center',
        }}
      >
        <Video
          src={firstClip.videoPath}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: `blur(${blurPx}px) brightness(${brightness}) saturate(0.95)`,
          }}
          volume={0}
        />
      </AbsoluteFill>

      {/* Scrim — eases from heavy to readable as reveal progresses. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${scrim * 0.85}) 0%, rgba(0,0,0,${scrim}) 100%)`,
        }}
      />

      {/* Vertical accent rule — appears with the settled name. */}
      <div
        style={{
          position: 'absolute',
          left: `${LT.accentLeft}%`,
          top: `${LT.accentTop}%`,
          width: 2,
          height: LT.accentHeight,
          backgroundColor: COLORS.hairline,
          opacity: accentOpacity,
          overflow: 'hidden',
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

      {/* Guest name — animates from screen-center to lower-third. */}
      <div
        style={{
          position: 'absolute',
          left: `${nameLeftPct}%`,
          top: `${nameTopPct}%`,
          transform: `translate(${nameTxPct}%, ${nameTyPct}%) translateY(${nameEntrance.y}px)`,
          opacity: nameEntrance.opacity,
          color: COLORS.textPrimary,
          fontSize: nameFontSize,
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: nameLetterSpacing,
          lineHeight: 1.0,
          whiteSpace: 'nowrap',
          willChange: 'transform, font-size',
        }}
      >
        {guest.name}
      </div>

      {/* Title — anchored to lower-third, fades in after the move. */}
      <div
        style={{
          position: 'absolute',
          left: `${LT.leftPad}%`,
          top: `${LT.titleTop}%`,
          opacity: title.opacity,
          transform: `translateY(${title.y}px)`,
          color: branding.primaryColor,
          fontSize: 22,
          fontWeight: 500,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {guest.title}
      </div>

      {/* Company */}
      <div
        style={{
          position: 'absolute',
          left: `${LT.leftPad}%`,
          top: `${LT.companyTop}%`,
          opacity: company.opacity,
          transform: `translateY(${company.y}px)`,
          color: COLORS.textSecondary,
          fontSize: 18,
          fontWeight: 400,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {guest.company}
      </div>

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
