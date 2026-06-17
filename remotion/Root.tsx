import React from 'react';
import { Trailer } from './compositions/Trailer';
import { buildTimeline } from './utils/timing';
import { TrailerProps } from './types';

import { Composition, registerRoot, staticFile } from 'remotion';

/**
 * Default props — also serves as documentation of the full schema.
 *
 * Every nested `colors`, `fonts`, `copy` field is OPTIONAL. Omit them and you
 * get the design-system defaults (dark navy/cream/gold + Playfair + Montserrat
 * + English UI strings). Pass them and the trailer re-themes instantly.
 *
 * To produce a different client's video: change `branding`, `clips`, `guest`,
 * `episode`, `musicPath`. No code edits required.
 */
const defaultProps: TrailerProps = {
  clips: [
    {
      videoPath: staticFile('Finding_the_Balance_Between_AI_and_Authenticity.mp4'),
      title: 'Finding the Balance Between AI and Authenticity',
      duration: 8,
    },
    {
      videoPath: staticFile('The_AI_Tool_That_Writes_Your_Workbooks.mp4'),
      title: 'The AI Tool That Writes Your Workbooks',
      duration: 9,
    },
    {
      videoPath: staticFile('Turning_Podcast_Episodes_into_Workbooks.mp4'),
      title: 'Turning Podcast Episodes into Workbooks',
      duration: 9,
    },
  ],
  guest: {
    name: 'Trent Allday',
    title: 'AI Content Strategist',
    company: 'CommTogether',
    photoPath: staticFile('Anthony_Perl_Profile_Picture.jpg'),
    linkedIn: 'anthonyperl',
  },
  episode: {
    title: 'How AI Is Eating Content Creation',
    number: 'Coming Soon',
    pullQuote:
      "Don't you want to be the one they're pulling from — so others end up quoting you?",
    pullQuoteAttribution: '— Anthony Perl',
    // Words/phrases inside the quote that get highlighted in colors.primary.
    pullQuoteHighlights: [
      "they're pulling from",
      'quoting you',
    ],
  },
  branding: {
    // ── Identity ────────────────────────────────────────────────────────────
    showName: 'MangoMagic',
    hostName: 'Felipe Zuluaga',
    tagline: 'Real Conversations. Real AI.',
    logoPath: staticFile('mango_logo.png'),

    // ── Colors — every key is optional, defaults shown for reference ──────
    colors: {
      primary:        '#F1AB1C',  // brand accent (lines, highlights, dots)
      accent:         '#F6F0E2',  // secondary accent
      background:     '#0a0a0a',  // near-black default scene bg
      backgroundDeep: '#080808',  // clip segment bg
      cutBackground:  '#050505',  // transition card bg
      navy:           '#111527',  // guest card + pull quote bg
      cream:          '#F6F0E2',  // brand cream
      textPrimary:    '#ffffff',
      textSecondary:  'rgba(255, 255, 255, 0.65)',
      textTertiary:   'rgba(255, 255, 255, 0.42)',
      textCream:      '#F6F0E2',  // text on navy
      textCreamDim:   'rgba(246, 240, 226, 0.65)',
      textNavy:       '#111527',  // text on gold (Outro)
      hairline:       'rgba(255, 255, 255, 0.08)',
    },

    // ── Fonts — install via @remotion/google-fonts or include in index.html
    fonts: {
      display: "'Playfair Display', Georgia, serif",
      body:    "'Montserrat', system-ui, sans-serif",
    },

    // ── Copy — every UI label / prefix is overridable ──────────────────────
    copy: {
      watermark:      '@mangomagic', // pass '' to hide entirely
      introducing:    'Introducing',
      upNext:         'Up Next',
      availableNow:   'Available Now',
      episodePrefix:  'Episode',
      withHost:       'With',
      linkedInPrefix: 'in/',
      clipPrefix:     'CLIP',
    },
  },
  motion: {
    energy: 'hype',
    colorGrade: 'warm',
  },
  musicPath: staticFile('Anthony Perl.mp3'),
  musicTrimStart: 4,
};

export const RemotionRoot: React.FC = () => {
  const timeline = buildTimeline(defaultProps);

  return (
    <Composition
      id="Trailer"
      component={Trailer as unknown as React.ComponentType<Record<string, unknown>>}
      durationInFrames={timeline.totalFrames}
      fps={30}
      width={1280}
      height={720}
      defaultProps={defaultProps as unknown as Record<string, unknown>}
      calculateMetadata={async ({ props }) => {
        const tl = buildTimeline(props as unknown as TrailerProps);
        return { durationInFrames: tl.totalFrames };
      }}
    />
  );
};

registerRoot(RemotionRoot);
