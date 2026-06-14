export interface ClipProp {
  videoPath: string;
  title: string;
  duration: number; // in seconds
}

export interface GuestProp {
  name: string;
  title: string;
  company: string;
}

export interface EpisodeProp {
  title: string;
  number: string;
}

export interface BrandingProp {
  primaryColor: string;
  logoPath: string;
  showName: string;
}

export interface TrailerProps {
  clips: ClipProp[];
  guest: GuestProp;
  episode: EpisodeProp;
  branding: BrandingProp;
  musicPath: string;
}

// ─── Timing helper — describes where each section sits on the timeline ─────
export interface SectionTiming {
  start: number;  // in frames
  duration: number; // in frames
}

export interface TrailerTimeline {
  intro: SectionTiming;
  guestCard: SectionTiming;
  clips: SectionTiming[];
  transitions: SectionTiming[];
  outro: SectionTiming;
  totalFrames: number;
}