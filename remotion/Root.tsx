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
      videoPath: staticFile('What_Happens_When_Technology_Thinks.mp4'),
      title: 'What Happens When Technology Thinks?',
      duration: 9,
    },
    {
      videoPath: staticFile('Will_AI_Change_Cybersecurity_Forever.mp4'),
      title: 'Will AI Change Cybersecurity Forever?',
      duration: 9,
    },
    {
      videoPath: staticFile('Are_Attackers_Always_One_Step_Ahead.mp4'),
      title: 'Are Attackers Always One Step Ahead?',
      duration: 9,
    },
    {
      videoPath: staticFile('Balancing_Speed_and_Governance.mp4'),
      title: 'Balancing Speed and Governance',
      duration: 9,
    },
    {
      videoPath: staticFile('AIs_Role_in_Cyber_Defense.mp4'),
      title: "AI's Role in Cyber Defense",
      duration: 9,
    }
  ],
  guest: {
    name: 'Rajiv Punia',
    title: 'Founder & Chief Executive',
    company: 'Shoonya',
    photoPath: staticFile('Rajiv.png'), // Untouched
    linkedIn: 'rajivpunia',
  },
  episode: {
    title: 'The Intersection of AI and OT',
    number: 'Coming Soon',
    pullQuote: 'The purpose of cybersecurity is not to remove every priority. It is to stop the business from being compromised.',
    pullQuoteAttribution: '— Rajiv Punia',
    pullQuoteHighlights: [
      'stop the business',
      'being compromised',
      'not to remove every ',
    ],
  },
  branding: {
    // ── Identity ────────────────────────────────────────────────────────────
    showName: 'Cyberwins',
    hostName: 'Hayden Loader',
    tagline: 'What actually worked in enterprise cybersecurity, and why',
    logoPath: staticFile('anz_logo.png'), // Untouched

    // ── Colors ──────────────────────────────────────────────────────────────
    colors: {
      primary:        '#C0AAEC', // Updated from JSON
      accent:         '#F6F0E2',
      background:     '#0a0a0a',
      backgroundDeep: '#080808',
      cutBackground:  '#050505',
      navy:           '#111527',
      cream:          '#F6F0E2',
      textPrimary:    '#ffffff',
      textSecondary:  'rgba(255, 255, 255, 0.65)',
      textTertiary:   'rgba(255, 255, 255, 0.42)',
      textCream:      '#F6F0E2',
      textCreamDim:   'rgba(246, 240, 226, 0.65)',
      textNavy:       '#111527',
      hairline:       'rgba(255, 255, 255, 0.08)',
    },

    // ── Fonts ───────────────────────────────────────────────────────────────
    fonts: {
      display: "'Playfair Display', Georgia, serif",
      body:    "'Montserrat', system-ui, sans-serif",
    },

    // ── Copy ────────────────────────────────────────────────────────────────
    copy: {
      watermark:      '@cyberwins',
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
  musicPath: staticFile('Rajiv Punia.mp3'), // Untouched
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
