import {
  BrandingProp,
  ResolvedBranding,
  BrandColors,
  BrandFonts,
  BrandCopy,
} from '../types';

// ─── Default palette ─────────────────────────────────────────────────────────
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
 *   • `branding.colors.primary` wins over `branding.primaryColor` (back-compat).
 *   • Every color/font/copy key falls back to the design-system default.
 *   • Every field on the result is provably non-undefined — components can read
 *     `branding.colors.navy` etc. without nullable checks.
 *
 * Per-field nullish-coalescing (instead of object spread) is intentional so
 * TypeScript's strict mode is satisfied that the result matches
 * `Required<BrandColors>` etc.
 */
export const resolveBranding = (b: BrandingProp): ResolvedBranding => {
  const c  = b.colors ?? {};
  const f  = b.fonts  ?? {};
  const cp = b.copy   ?? {};

  const primary = c.primary ?? b.primaryColor ?? DEFAULT_COLORS.primary;
  const accent  = c.accent  ?? b.accentColor  ?? DEFAULT_COLORS.accent;

  const colors: Required<BrandColors> = {
    primary,
    accent,
    background:     c.background     ?? DEFAULT_COLORS.background,
    backgroundDeep: c.backgroundDeep ?? DEFAULT_COLORS.backgroundDeep,
    cutBackground:  c.cutBackground  ?? DEFAULT_COLORS.cutBackground,
    navy:           c.navy           ?? DEFAULT_COLORS.navy,
    cream:          c.cream          ?? DEFAULT_COLORS.cream,
    textPrimary:    c.textPrimary    ?? DEFAULT_COLORS.textPrimary,
    textSecondary:  c.textSecondary  ?? DEFAULT_COLORS.textSecondary,
    textTertiary:   c.textTertiary   ?? DEFAULT_COLORS.textTertiary,
    textCream:      c.textCream      ?? DEFAULT_COLORS.textCream,
    textCreamDim:   c.textCreamDim   ?? DEFAULT_COLORS.textCreamDim,
    textNavy:       c.textNavy       ?? DEFAULT_COLORS.textNavy,
    hairline:       c.hairline       ?? DEFAULT_COLORS.hairline,
  };

  const fonts: Required<BrandFonts> = {
    display: f.display ?? DEFAULT_FONTS.display,
    body:    f.body    ?? DEFAULT_FONTS.body,
  };

  const copy: Required<BrandCopy> = {
    watermark:      cp.watermark      ?? DEFAULT_COPY.watermark,
    introducing:    cp.introducing    ?? DEFAULT_COPY.introducing,
    upNext:         cp.upNext         ?? DEFAULT_COPY.upNext,
    availableNow:   cp.availableNow   ?? DEFAULT_COPY.availableNow,
    episodePrefix:  cp.episodePrefix  ?? DEFAULT_COPY.episodePrefix,
    withHost:       cp.withHost       ?? DEFAULT_COPY.withHost,
    linkedInPrefix: cp.linkedInPrefix ?? DEFAULT_COPY.linkedInPrefix,
    clipPrefix:     cp.clipPrefix     ?? DEFAULT_COPY.clipPrefix,
  };

  return {
    showName:     b.showName,
    hostName:     b.hostName,
    tagline:      b.tagline,
    logoPath:     b.logoPath,
    primaryColor: primary,
    accentColor:  accent,
    colors,
    fonts,
    copy,
  };
};
