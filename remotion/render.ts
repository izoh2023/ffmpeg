import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { TrailerProps } from './types';

const EXPRESS_PORT = process.env.PORT ?? '9000';

// ─── Find Chromium executable ─────────────────────────────────────────────────
function getChromiumExecutable(): string | undefined {
  const candidates = [
    path.join(process.cwd(), 'node_modules', '.remotion', 'chrome-headless-shell', 'linux64', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    path.join(__dirname, '..', 'node_modules', '.remotion', 'chrome-headless-shell', 'linux64', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`[Remotion] Using browser: ${candidate}`);
      return candidate;
    }
  }

  console.warn('[Remotion] No browser found in candidates, letting Remotion auto-detect...');
  return undefined;
}

// ─── Resolve assets via Express static server ─────────────────────────────────
function stageAssets(props: TrailerProps): TrailerProps {
  return {
    ...props,
    guest: {
      ...props.guest,
      photoPath: props.guest.photoPath
        ? `http://localhost:${EXPRESS_PORT}/static/${path.basename(props.guest.photoPath)}`
        : '',
    },
    branding: {
      ...props.branding,
      logoPath: props.branding.logoPath
        ? `http://localhost:${EXPRESS_PORT}/static/${path.basename(props.branding.logoPath)}`
        : '',
    },
    musicPath: props.musicPath
      ? `http://localhost:${EXPRESS_PORT}/static/${path.basename(props.musicPath)}`
      : '',
  };
}

// ─── Main render function ─────────────────────────────────────────────────────
export async function renderTrailer(
  props: TrailerProps,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {

  const resolvedProps = stageAssets(props);

  console.debug(resolvedProps)
  const inputProps = resolvedProps as unknown as Record<string, unknown>;

  console.log('[Remotion] Bundling composition...');

  const bundled = await bundle({
    // Use process.cwd() so this resolves to /app/remotion/Root.tsx in Docker
    // instead of /app/dist/remotion/Root.tsx (which doesn't exist)
    entryPoint: path.resolve(process.cwd(), 'remotion/Root.tsx'),
    webpackOverride: (config) => config,
  });

  console.log('[Remotion] Bundle complete. Selecting composition...');

  const browserExecutable = getChromiumExecutable();

  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'Trailer',
    inputProps,
    browserExecutable,
  });

  console.log(`[Remotion] Composition selected. Total frames: ${composition.durationInFrames}`);

 await renderMedia({
    composition,
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    browserExecutable,
    concurrency: 2, // ← was os.cpus().length, too many parallel Chrome instances
    x264Preset: 'ultrafast',
    onProgress: ({ progress }) => {
      const percent = Math.round(progress * 100);
      console.log(`[Remotion] Rendering: ${percent}%`);
      if (onProgress) onProgress(percent);
    },
    timeoutInMilliseconds: 30 * 60 * 1000,
    chromiumOptions: {
      disableWebSecurity: true,
      gl: 'swiftshader',
    },
    videoBitrate: '2M', 
  });

  console.log(`[Remotion] Render complete: ${outputPath}`);
  return outputPath;
}