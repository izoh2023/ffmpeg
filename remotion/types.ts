export interface ClipProp {
  videoPath: string;
  title: string;
  duration: number;          // in seconds
  captionOverride?: string;  // shorter label for lower third if title is too long
}

export interface GuestProp {
  name: string;
  title: string;
  company: string;
  photoPath: string;         // e.g. staticFile('guest_photo.png')
  linkedIn?: string;         // handle only, e.g. 'anthonyperl' — shown as @handle
}

export interface EpisodeProp {
  title: string;
  number: string;
  pullQuote: string;               // one punchy line from transcript
  pullQuoteAttribution: string;    // e.g. '— Anthony Perl'
  /**
   * Phrases inside `pullQuote` that should be highlighted in the brand
   * primary color. Case-insensitive; trailing/leading punctuation is ignored
   * during matching. Defaults to [] (no highlights).
   */
  pullQuoteHighlights?: string[];
}

// ─── Branding — everything below is overridable per-client ──────────────────

export interface BrandColors {
  /** Main brand accent (lines, highlights). Required. */
  primary?: string;
  /** Secondary accent (rarely used; defaults to cream). */
  accent?: string;

  /** Default scene background — near-black, never pure #000. */
  background?: string;
  /** Slightly deeper bg for clip segments. */
  backgroundDeep?: string;
  /** Background of the "Up Next" transition card. */
  cutBackground?: string;

  /** Brand navy — used as the Guest Card + Pull Quote background. */
  navy?: string;
  /** Brand light tone — base color for cream-on-dark text. */
  cream?: string;

  /** Primary text color (usually white on dark). */
  textPrimary?: string;
  /** Body / paragraph text (slightly dimmer). */
  textSecondary?: string;
  /** Hint / eyebrow text. */
  textTertiary?: string;

  /** Used when navy is the BG and text needs to be readable. */
  textCream?: string;
  /** Dimmer cream — captions and watermarks. */
  textCreamDim?: string;
  /** Used when gold is the BG (Outro) and text needs contrast. */
  textNavy?: string;

  /** Hairline rule color. */
  hairline?: string;
}

export interface BrandFonts {
  /** Display / headlines — typically a serif. */
  display?: string;
  /** Body / labels — typically a sans-serif. */
  body?: string;
}

export interface BrandCopy {
  /** Corner watermark on the Guest Card. Pass '' to hide. */
  watermark?: string;
  /** Eyebrow above the guest name. */
  introducing?: string;
  /** "Up Next" eyebrow on the Transition card. */
  upNext?: string;
  /** Outro CTA — appears beneath the episode title. */
  availableNow?: string;
  /** Prefix in front of episode.number on the Intro. */
  episodePrefix?: string;
  /** Host attribution in the Intro slate. */
  withHost?: string;
  /** Prefix for LinkedIn handle. */
  linkedInPrefix?: string;
  /** Prefix for clip marker (e.g. "CLIP 01"). */
  clipPrefix?: string;
}

export interface BrandingProp {
  // ── Identity ──────────────────────────────────────────────────────────────
  showName: string;
  hostName?: string;
  tagline?: string;
  logoPath: string;

  // ── Theme (everything below is optional with sensible defaults) ──────────
  colors?: BrandColors;
  fonts?: BrandFonts;
  copy?: BrandCopy;

  // ── Back-compat shortcuts (also fill colors.primary / colors.accent) ─────
  primaryColor?: string;
  accentColor?: string;
}

/**
 * Branding after resolveBranding() — every theme field is guaranteed.
 * This is the type passed to scene components.
 */
export interface ResolvedBranding {
  showName: string;
  hostName?: string;
  tagline?: string;
  logoPath: string;
  primaryColor: string;
  accentColor: string;
  colors: Required<BrandColors>;
  fonts: Required<BrandFonts>;
  copy: Required<BrandCopy>;
}

export interface MotionProp {
  energy: 'calm' | 'hype' | 'cinematic';
  colorGrade?: 'warm' | 'cool' | 'neutral';
}

export interface TrailerProps {
  clips: ClipProp[];
  guest: GuestProp;
  episode: EpisodeProp;
  branding: BrandingProp;
  motion: MotionProp;
  musicPath: string;
  musicTrimStart?: number;         // seconds into the track to begin (hit the drop)
}

// ─── Timing helper ─────────────────────────────────────────────────────────────
export interface SectionTiming {
  start: number;    // in frames
  duration: number; // in frames
}

/**
 * A single beat in the trailer. Sequential layout:
 *   intro → guestCard → [clip, transition] × N → pullQuote → outro
 */
export type BeatKind =
  | 'intro'
  | 'guestCard'
  | 'clip'         // a source clip plays full-length, full bleed
  | 'transition'   // "UP NEXT" card between clips
  | 'pullQuote'
  | 'outro';

export interface TrailerBeat {
  kind: BeatKind;
  start: number;       // in frames
  duration: number;    // in frames

  // ─── Per-kind data (optional) ───────────────────────────────────────────
  clipIdx?: number;    // index into props.clips (clip beats)
  isFirst?: boolean;   // first clip — render extra guest attribution
  title?: string;      // next clip's title (transition beats)
}

export interface TrailerTimeline {
  // Beat-based timeline — the new source of truth
  beats: TrailerBeat[];

  // Back-compat — top-level pointers some renderers still read
  intro: SectionTiming;
  guestCard: SectionTiming;
  pullQuote: SectionTiming;
  outro: SectionTiming;

  totalFrames: number;
}
