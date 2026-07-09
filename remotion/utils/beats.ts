/**
 * Converts the render API's absolute-second beat data into frame offsets
 * inside the trailer's own timeline, so scene components can react to the
 * music without knowing anything about seconds, trims, or fps.
 */
export function beatFramesInWindow(
  musicBeats: number[] | undefined,
  musicBpm: number | undefined,
  musicTrimStart: number,
  fps: number,
  totalFrames: number
): number[] {
  if (musicBeats && musicBeats.length) {
    return musicBeats
      .map((t) => Math.round((t - musicTrimStart) * fps))
      .filter((f) => f >= 0 && f <= totalFrames);
  }

  // No detected beats (analysis failed, or an old caller that doesn't send
  // them) — fall back to a steady synthetic grid from the estimated tempo
  // so the beat-reactive accents still have *something* to lock onto.
  if (musicBpm && musicBpm > 0) {
    const framesPerBeat = (60 / musicBpm) * fps;
    const grid: number[] = [];
    for (let f = 0; f <= totalFrames; f += framesPerBeat) grid.push(Math.round(f));
    return grid;
  }

  return [];
}

/**
 * Slices `beatFrames` (absolute, trailer-timeline frames) down to the beats
 * that fall inside [from, to), re-expressed relative to `from` — i.e. in the
 * same local frame space a Sequence's useCurrentFrame() reports.
 */
export function beatsWithin(beatFrames: number[], from: number, to: number): number[] {
  return beatFrames.filter((f) => f >= from && f < to).map((f) => f - from);
}
