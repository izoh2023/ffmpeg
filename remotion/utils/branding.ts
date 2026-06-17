import {
  BrandingProp,
  ResolvedBranding,
  BrandColors,
  BrandFonts,
  BrandCopy,
} from '../types';

// ─── Default palette ─────────────────────────────────────────────────────────
// All colors here are overridable per-client via `branding.colors.*`.
// The defaults reproduce the existing podcast aesthetic so existing trailers
// keep working when only identity fields are supplied.
const DEFAULT_COLORS: Required<BrandColors> = {
  primary: '#F1AB1C',
  accent: '#F6F0E2',
  background: '#0a0a0a',
  backgroundDeep: '#080808',
  cutBackground: '#050505',
  navy: '#111527',
  cream: '#F6F0E2',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  textTertiary: 'rgba(255, 255, 255, 0.42)',
  textCream: '#F6F0E2',
  textCreamDim: 'rgba(246, 240, 226, 0.65)',
  textNavy: '#111527',
  hairline: 'rgba(255, 255, 255, 0.08)',
};

const DEFAULT_FONTS: Required<BrandFonts> = {
  display: "'Playfair Display', Georgia, serif",
  body: "'Montserrat', system-ui, sans-serif",
};

const DEFAULT_COPY: Required<BrandCopy> = {
  watermark: '',
  introducing: 'Introducing',
  upNext: 'Up Next',
  availableNow: 'Available Now',
  episodePrefix: 'Episode',
  withHost: 'With',
  linkedInPrefix: 'in/',
  clipPrefix: 'CLIP',
};

/**
 * Merge a user-supplied BrandingProp with defaults to produce a ResolvedBranding.
 *
 * Resolution rules:
 *   • `branding.colors.primary` wins over `branding.primaryColor` (back-compat).
 *   • Any color/font/copy key the user doesn't specify falls back to the default.
 *   • The resolved object has EVERY field populated — components can read
 *     `branding.colors.navy` etc. without nullable checks.
 *
 * Call this once at the top of the composition; pass the result to every scene.
 */
export const resolveBranding = (b: BrandingProp): ResolvedBranding => {
  const primary = b.colors?.primary ?? b.primaryColor ?? DEFAULT_COLORS.primary;
  const accent  = b.colors?.accent  ?? b.accentColor  ?? DEFAULT_COLORS.accent;

  return {
    showName: b.showName,
    hostName: b.hostName,
    tagline: b.tagline,
    logoPath: b.logoPath,
    primaryColor: primary,
    accentColor: accent,
    colors: {
      ...DEFAULT_COLORS,
      ...b.colors,
      // Force primary/accent to the resolved values (they may have come from
      // the back-compat top-level keys, not from `colors`).
      primary,
      accent,
    },
    fonts: { ...DEFAULT_FONTS, ...b.fonts },
    copy: { ...DEFAULT_COPY, ...b.copy },
  };
};
