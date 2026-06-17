/**
 * useFonts — loads Playfair Display + Montserrat from Google Fonts.
 *
 * Uses Remotion's delayRender / continueRender so the renderer waits
 * for fonts to load before capturing the first frame. Without this,
 * Chromium may fall back to system fonts during render.
 *
 * Usage: call `useFonts()` at the top of your root Trailer component.
 *
 * Alternative (recommended for production):
 *   npm install @remotion/google-fonts
 *   In Root.tsx:
 *     import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay'
 *     import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat'
 *     loadPlayfair(); loadMontserrat();
 */
import { useEffect, useMemo } from 'react';
import { continueRender, delayRender } from 'remotion';

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?' +
  'family=Playfair+Display:wght@400;600;700;900&' +
  'family=Montserrat:wght@300;400;500;600;700&' +
  'display=swap';

export const useFonts = (): void => {
  const handle = useMemo(() => delayRender('Loading Google Fonts'), []);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;

    const onLoad = () => {
      // Wait for the browser to actually parse + load the font faces
      document.fonts.ready.then(() => continueRender(handle));
    };
    const onError = () => {
      // Don't block rendering if CDN is unreachable (e.g. offline render env)
      console.warn('[useFonts] Failed to load Google Fonts — falling back to system fonts');
      continueRender(handle);
    };

    link.addEventListener('load', onLoad);
    link.addEventListener('error', onError);
    document.head.appendChild(link);

    return () => {
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
    };
  }, [handle]);
};
