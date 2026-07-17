import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ResolvedBranding, MotionProp } from '../types';
import {
  EASE_EXPO_OUT,
  colorGradeTint,
  flashCut,
  typewriterChars,
} from './utils/animations';

interface TransitionProps {
  title: string;
  branding: ResolvedBranding;
  motion: MotionProp;
}

/**
 * Inter-clip transition — typewriter title with broadcast-terminal feel.
 *
 * Layout (centered column, top → bottom):
 *
 *   ●  UP NEXT                    ← gold dot + eyebrow
 *
 *   The Title Types In Here|      ← character by character, gold cursor
 *
 *   ━━━━━━━━                       ← gold underline draws after typing settles
 *
 * Pacing (96 frames @ 30fps = 3.2s):
 *   00–18f   ease in (long crossfade with adjacent clip)
 *   12–28f   gold dot scales in + "UP NEXT" eases up
 *   24f      typing cursor appears at the start of the title row
 *   28–(28+typeDur)f   title types in
 *   typeDoneAt → end-22   cursor blinks, underline draws
 *   end-18 → end          ease out
 *
 * Adaptive typing speed: longer titles run at 1 frame/char (max speed),
 * shorter titles get slower per-char so the typing always feels deliberate.
 */
export const Transition: React.FC<TransitionProps> = ({ title, branding, motion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const TOTAL = Math.round(3.4 * fps); // 102f — matches TRANSITION_FRAMES
  const { colors, fonts, copy } = branding;

  // ─── Scene fades ────────────────────────────────────────────────────────
  const sceneIn = interpolate(frame, [0, 14], [0, 1], {
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

  // ─── Eyebrow + gold dot ─────────────────────────────────────────────────
  const dotScale = interpolate(frame, [10, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const eyebrowOpacity = interpolate(frame, [12, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const eyebrowY = interpolate(frame, [12, 24], [8, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  // ─── Typewriter — adaptive speed ────────────────────────────────────────
  // Long titles type fast (up to ~1.6 chars/frame), short titles slow.
  // The total typing duration stays under TYPE_BUDGET so the underline
  // and fade-out have predictable room.
  const TYPE_START = 28;
  const TYPE_BUDGET = 38;   // max frames spent typing
  const MIN_FPC = 0.5;       // don't reveal more than 2 chars/frame
  const MAX_FPC = 4;         // don't take longer than ~0.13s per char
  const titleLen = Math.max(1, title.length);
  const framesPerChar = Math.min(MAX_FPC, Math.max(MIN_FPC, TYPE_BUDGET / titleLen));
  const typeDurFrames = Math.ceil(titleLen * framesPerChar);
  const typeDoneAt = TYPE_START + typeDurFrames;

  const visibleChars = typewriterChars(frame, titleLen, TYPE_START, framesPerChar);
  const typedText = title.slice(0, visibleChars);
  const typingDone = visibleChars >= titleLen;

  // Title row fades in as the first character lands.
  const titleRowOpacity = interpolate(frame, [TYPE_START, TYPE_START + 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  // Cursor: visible while typing; blinks for a while after; disappears before fade-out.
  const sinceTypeDone = frame - typeDoneAt;
  const cursorBlinkOn = Math.floor(sinceTypeDone / 10) % 2 === 0;
  const cursorVisible =
    frame >= 24 &&
    frame < TOTAL - 16 &&
    (!typingDone || cursorBlinkOn);

  // ─── Gold underline — draws after the title is fully typed ──────────────
  const underlineStart = typeDoneAt + 6;
  const underlineProgress = interpolate(
    frame,
    [underlineStart, underlineStart + 14],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE_EXPO_OUT,
    }
  );
  const underlineOpacity = interpolate(
    frame,
    [underlineStart, underlineStart + 8],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE_EXPO_OUT,
    }
  );

  // ─── Optional brand-tinted wash on cut-in (hype only) ───────────────────
  const showSoftTint = motion.energy === 'hype';
  const softTintOpacity = interpolate(frame, [0, 4, 12], [0.18, 0.08, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });

  // ─── Color grade wash — same treatment as every other scene ─────────────
  const gradeOpacity = interpolate(frame, [10, 30], [0, 0.18], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE_EXPO_OUT,
  });
  const gradeTint = colorGradeTint(motion.colorGrade, colors.primary);

  // ─── Flash-cut spike — mirrors ClipSegment's tail flash at frame 0 ──────
  const cutFlash = flashCut(frame, 0, 0.8, 8);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.cutBackground, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          opacity: sceneOpacity,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          padding: '0 8%',
        }}
      >
      {/* Soft brand radial */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${colors.primary}10 0%, ${colors.cutBackground} 65%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Color grade wash */}
      <AbsoluteFill
        style={{
          background: gradeTint,
          opacity: gradeOpacity,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />

      {/* Eyebrow: ● UP NEXT */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          opacity: eyebrowOpacity,
          transform: `translateY(${eyebrowY}px)`,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            backgroundColor: colors.primary,
            boxShadow: `0 0 12px ${colors.primary}aa`,
            transform: `scale(${dotScale})`,
          }}
        />
        <div
          style={{
            color: colors.primary,
            fontFamily: fonts.body,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            paddingLeft: '0.42em',
          }}
        >
          {copy.upNext}
        </div>
      </div>

      {/* Title row — ghost layout + typed overlay + cursor */}
      <div
        style={{
          opacity: titleRowOpacity,
          position: 'relative',
          display: 'inline-block',
          textAlign: 'left',
          color: colors.textCream,
          fontFamily: fonts.display,
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: '-0.005em',
          lineHeight: 1.18,
          maxWidth: '82%',
        }}
      >
        <span style={{ visibility: 'hidden' }}>{title}</span>

        <span
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            whiteSpace: 'pre-wrap',
          }}
        >
          {typedText}
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 3,
              height: '0.78em',
              backgroundColor: colors.primary,
              marginLeft: 4,
              transform: 'translateY(0.05em)',
              opacity: cursorVisible ? 1 : 0,
              boxShadow: `0 0 8px ${colors.primary}88`,
            }}
          />
        </span>
      </div>

      {/* Gold underline */}
      <div
        style={{
          marginTop: 32,
          width: 80,
          height: 2,
          backgroundColor: colors.primary,
          boxShadow: `0 0 14px ${colors.primary}66`,
          opacity: underlineOpacity,
          clipPath: `inset(0 ${(1 - underlineProgress) * 100}% 0 0)`,
        }}
      />

      {/* Optional hype tint */}
      {showSoftTint && (
        <AbsoluteFill
          style={{
            background:
              `radial-gradient(ellipse at center, ${colors.primary}33 0%, transparent 70%)`,
            opacity: softTintOpacity,
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />
      )}
      </AbsoluteFill>

      {/* Flash-cut spike — independent of the scene's own fade-in so it
          reads at full punch right as the incoming clip's flash hands off. */}
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
