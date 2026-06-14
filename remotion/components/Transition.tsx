import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BrandingProp } from '../types';
import {
  COLORS,
  TIMING,
  fadeUp,
  letterSpacingSettle,
  drawIn,
  splitWords,
  wordStaggerStyle,
} from './utils/animations';

interface TransitionProps {
  title: string;
  branding: BrandingProp;
}

/**
 * Scene-to-scene transition.
 *
 * Acts as a dramatic fade-to-black bridge between major sections:
 *   00–08f   fade in from the cut frame
 *   08–34f   title reveals (word stagger, letter-spacing settle)
 *   12–34f   hairline accent draws in
 *   ──── hold ────
 *   end-12f  fade back out so the next scene cuts cleanly
 */
export const Transition: React.FC<TransitionProps> = ({ title, branding }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const TOTAL_F = 2 * fps; // 60f

  // Scene-level fade so this card always opens and closes through black.
  const sceneOpacity = interpolate(
    frame,
    [0, TIMING.fadeBlackIn, TOTAL_F - TIMING.fadeBlackOut, TOTAL_F],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Title — word-staggered fade-up + letter-spacing settle.
  const titleWords = splitWords(title);
  const titleLetterSpacing = letterSpacingSettle(frame, 8, 0.06, -0.015);

  // Eyebrow label — small, tracked, calm.
  const eyebrow = fadeUp(frame, fps, 10, 8);

  // Hairline rule beneath the title.
  const ruleProgress = drawIn(frame, 12, TIMING.introLong);
  const ruleOpacity = fadeUp(frame, fps, 12, 6).opacity;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.cut,
        opacity: sceneOpacity,
        overflow: 'hidden',
      }}
    >
      {/* Soft single-color radial — atmosphere, not decoration. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${branding.primaryColor}0d 0%, ${COLORS.cut} 65%)`,
        }}
      />

      {/* Centered content stack. */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          padding: '0 12%',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            opacity: eyebrow.opacity,
            transform: `translateY(${eyebrow.y}px)`,
            color: branding.primaryColor,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'Inter, sans-serif',
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            marginBottom: 22,
            paddingLeft: '0.42em',
          }}
        >
          Up Next
        </div>

        {/* Title */}
        <div
          style={{
            color: COLORS.textPrimary,
            fontSize: 56,
            fontWeight: 600,
            fontFamily: 'Inter, sans-serif',
            letterSpacing: titleLetterSpacing,
            textAlign: 'center',
            lineHeight: 1.18,
            maxWidth: '78%',
          }}
        >
          {titleWords.map((word, i) => (
            <span
              key={i}
              style={{
                ...wordStaggerStyle(frame, fps, i, 8, TIMING.staggerWord, 14),
                marginRight: i === titleWords.length - 1 ? 0 : '0.32em',
              }}
            >
              {word}
            </span>
          ))}
        </div>

        {/* Hairline rule */}
        <div
          style={{
            width: 180,
            height: 1,
            backgroundColor: COLORS.hairline,
            marginTop: 28,
            overflow: 'hidden',
            opacity: ruleOpacity,
          }}
        >
          <div
            style={{
              width: `${ruleProgress * 100}%`,
              height: '100%',
              backgroundColor: branding.primaryColor,
            }}
          />
        </div>
      </AbsoluteFill>

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
