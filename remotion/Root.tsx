import React from 'react';
import { Trailer } from './compositions/Trailer';
import { buildTimeline } from './utils/timing';
import { TrailerProps } from './types';

import { Composition, registerRoot, staticFile } from 'remotion';

const defaultProps: TrailerProps = {
  clips: [
    {
      videoPath: staticFile('Finding_the_Balance_Between_AI_and_Authenticity.mp4'),
      title: 'Finding the Balance Between AI and Authenticity',
      duration: 18.7,
    },
    {
      videoPath: staticFile('The_AI_Tool_That_Writes_Your_Workbooks.mp4'),
      title: 'The AI Tool That Writes Your Workbooks',
      duration: 35.3,
    },
    {
      videoPath: staticFile('Turning_Podcast_Episodes_into_Workbooks.mp4'),
      title: 'Turning Podcast Episodes into Workbooks',
      duration: 39,
    },
  ],
  guest: {
    name: 'Anthony Perl',
    title: 'AI Content Strategist',
    company: 'CommTogether',
  },
  episode: {
    title: 'How AI Is Eating Content Creation',
    number: 'Coming Soon',
  },
  branding: {
    primaryColor: '#F1AB1C',
    logoPath: staticFile('mango_logo.png'),
    showName: 'The AI Podcast',
  },
  musicPath: staticFile('Anthony Perl.mp3'),
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