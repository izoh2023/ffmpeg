import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ResolvedBranding, EpisodeProp } from '../types';
import {
  EASE_EXPO_OUT,
  breathePulse,
  beatPulse,
  fadeIn,
  fadeOut,
  fadeUp,
  splitWords,
} from './utils/animations';

interface PullQuoteProps {
  episode: EpisodeProp;
  branding: ResolvedBranding;
  /** Beat frames (local to this scene's Sequence). */
  beatFrames?: number[];
}

/**
 * Scene 4 — Pull quote. Theme-driven; highlight phrases come from
 * `episode.pullQuoteHighlights` so each client can pick their own.
 */
export const PullQuote: React.FC<PullQuoteProps> = ({ episode, branding, beatFrames = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = 6 * fps; // 180f

  const { colors, fonts } = branding;

  const sceneIn  = fadeIn(frame, 0, 14);
  const sceneOut = fadeOut(frame, duration - 18, 18);
  const sceneOpacity = Math.min(sceneIn, sceneOut);

  // Gentle sinusoidal breathing, plus a barely-there lift on each beat so the
  // card doesn't sit dead-still if the music is still going underneath it.
  const breathe = breathePulse(frame, fps, 0.005) + beatPulse(frame, beatFrames, 3, 20) * 0.01;

  const quoteWords = splitWords(episode.pullQuote);
  const highlightFlags = markHighlightWords(
    quoteWords,
    episode.pullQuoteHighlights ?? []
  );

  const WORD_BASE_DELAY = 14;
  const PER_WORD = 7;

  const lastWordEnd = WORD_BASE_DELAY + (quoteWords.length - 1) * PER_WORD + 18;
  const attribution = fadeUp(frame, fps, lastWordEnd + 12, 10);

  return (
    <AbsoluteFill
      style={{
        opacity: sceneOpacity,
        backgroundColor: colors.navy,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        padding: '0 10%',
        overflow: 'hidden',
      }}
    >
      {/* Subtle brand radial glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, ${colors.primary}14 0%, ${colors.navy} 65%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Large faded quote mark */}
      <div
        style={{
          opacity: interpolate(frame, [4, 16], [0, 0.10], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          color: colors.primary,
          fontFamily: fonts.display,
          fontSize: 240,
          fontWeight: 900,
          lineHeight: 0.7,
          marginBottom: 0,
          pointerEvents: 'none',
        }}
      >
        “
      </div>

      {/* Quote — word-by-word reveal with optional highlights */}
      <div
        style={{
          transform: `scale(${breathe})`,
          transformOrigin: 'center center',
          maxWidth: 960,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            color: colors.textCream,
            fontFamily: fonts.display,
            fontSize: 50,
            fontWeight: 700,
            lineHeight: 1.18,
            letterSpacing: '-0.005em',
          }}
        >
          {quoteWords.map((word, i) => {
            const wordDelay = WORD_BASE_DELAY + i * PER_WORD;
            const t = interpolate(
              frame,
              [wordDelay, wordDelay + 14],
              [0, 1],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: EASE_EXPO_OUT,
              }
            );
            const isHighlighted = highlightFlags[i];
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  opacity: t,
                  transform: `translateY(${(1 - t) * 14}px)`,
                  color: isHighlighted ? colors.primary : colors.textCream,
                  marginRight: i === quoteWords.length - 1 ? 0 : '0.28em',
                  willChange: 'transform, opacity',
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>

      {/* Attribution */}
      <div
        style={{
          opacity: attribution.opacity,
          transform: `translateY(${attribution.y}px)`,
          marginTop: 38,
          color: colors.textCreamDim,
          fontFamily: fonts.body,
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          paddingLeft: '0.18em',
        }}
      >
        {episode.pullQuoteAttribution}
      </div>

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * For each word in `words`, returns true if that word is part of any phrase
 * in `phrases`. Case-insensitive; leading/trailing punctuation is ignored.
 */
function markHighlightWords(words: string[], phrases: string[]): boolean[] {
  const norm = (w: string) =>
    w.toLowerCase().replace(/[—,.;:!?"]+$/g, '').replace(/^[—,.;:!?"]+/, '');
  const normWords = words.map(norm);

  const flags = new Array<boolean>(words.length).fill(false);

  for (const phrase of phrases) {
    const phraseTokens = phrase.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
    if (phraseTokens.length === 0) continue;

    for (let i = 0; i <= normWords.length - phraseTokens.length; i++) {
      let match = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (normWords[i + j] !== phraseTokens[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        for (let j = 0; j < phraseTokens.length; j++) flags[i + j] = true;
      }
    }
  }

  return flags;
}
