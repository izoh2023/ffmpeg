import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

// Mono/low-rate PCM is plenty for energy-based onset detection and keeps the
// decode + analysis fast even on long tracks.
const SAMPLE_RATE = 11025;
const ANALYSIS_SECONDS_CAP = 120; // never analyze more than 2 minutes of audio

export interface BeatAnalysis {
  bpm: number;
  /** Absolute timestamps (seconds, from the start of the source file) where a beat was detected. */
  beatTimesSec: number[];
  /** Best-guess point to trim into — where the track's energy first jumps, snapped to a beat. */
  suggestedTrimStart: number;
}

const EMPTY_ANALYSIS: BeatAnalysis = { bpm: 0, beatTimesSec: [], suggestedTrimStart: 0 };

/**
 * Energy-based beat detector: decodes audio to mono PCM via ffmpeg, then
 * flags frames whose short-window energy spikes above a locally adaptive
 * threshold ("instant energy vs. local average" onset detection). No audio
 * decoding npm dependency needed — ffmpeg is already a hard requirement of
 * this service.
 */
export async function detectBeats(audioPath: string): Promise<BeatAnalysis> {
  const tmpPcm = path.join(
    os.tmpdir(),
    `beatdet_${Date.now()}_${Math.random().toString(36).slice(2)}.pcm`
  );

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", audioPath,
      "-t", String(ANALYSIS_SECONDS_CAP),
      "-ac", "1",
      "-ar", String(SAMPLE_RATE),
      "-f", "s16le",
      tmpPcm,
    ]);

    const buffer = fs.readFileSync(tmpPcm);
    const usableLength = buffer.length - (buffer.length % 2);
    const samples = new Int16Array(
      buffer.buffer,
      buffer.byteOffset,
      usableLength / 2
    );

    return analyzeSamples(samples, SAMPLE_RATE);
  } catch (err) {
    console.warn("[beatDetection] ffmpeg decode/analysis failed:", err);
    return EMPTY_ANALYSIS;
  } finally {
    fs.promises.unlink(tmpPcm).catch(() => {});
  }
}

function analyzeSamples(samples: Int16Array, sampleRate: number): BeatAnalysis {
  const HOP = Math.round(sampleRate * 0.02); // ~20ms energy frames
  const frameCount = Math.floor(samples.length / HOP);
  if (frameCount < 10) return EMPTY_ANALYSIS;

  const energy = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const start = i * HOP;
    for (let j = 0; j < HOP; j++) {
      const s = samples[start + j] / 32768;
      sum += s * s;
    }
    energy[i] = sum / HOP;
  }

  const framesPerSec = sampleRate / HOP;
  const HISTORY = Math.round(framesPerSec * 1.0); // ~1s rolling window
  const MIN_GAP = Math.round(framesPerSec * 0.25); // don't allow >240 BPM
  const EPS = 1e-9;

  const beatFrameIdx: number[] = [];
  let lastBeat = -Infinity;

  for (let i = 0; i < frameCount; i++) {
    const winStart = Math.max(0, i - HISTORY);
    const windowLen = i - winStart;
    if (windowLen < HISTORY / 2) continue; // let the rolling window fill up first

    let sum = 0;
    for (let j = winStart; j < i; j++) sum += energy[j];
    const localAvg = sum / windowLen;

    let variance = 0;
    for (let j = winStart; j < i; j++) {
      const d = energy[j] - localAvg;
      variance += d * d;
    }
    variance /= windowLen;

    // Coefficient-of-variation threshold: calm, steady passages trigger on a
    // smaller relative spike; already-dense/loud passages need a
    // proportionally bigger one. Keeps beat density roughly stable across a
    // track's dynamic range without depending on absolute signal level.
    const cv = Math.sqrt(variance) / (localAvg + EPS);
    const sensitivity = Math.min(1.8, 1.15 + cv * 0.6);
    const threshold = localAvg * sensitivity;

    if (energy[i] > threshold && energy[i] > EPS && i - lastBeat >= MIN_GAP) {
      beatFrameIdx.push(i);
      lastBeat = i;
    }
  }

  const beatTimesSec = beatFrameIdx.map((f) => (f * HOP) / sampleRate);
  const bpm = estimateBpm(beatTimesSec);
  const suggestedTrimStart = pickTrimStart(energy, framesPerSec, beatTimesSec);

  return { bpm, beatTimesSec, suggestedTrimStart };
}

function estimateBpm(beatTimesSec: number[]): number {
  if (beatTimesSec.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < beatTimesSec.length; i++) {
    intervals.push(beatTimesSec[i] - beatTimesSec[i - 1]);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (!median || median <= 0) return 0;
  return Math.round(60 / median);
}

/**
 * Finds the biggest jump in per-second energy within the first ~20s (a
 * reasonable proxy for "the drop"/where the track picks up), then snaps
 * that timestamp to the nearest beat at or after it so a scene cut landing
 * there feels intentional rather than arbitrary.
 */
function pickTrimStart(
  energy: Float64Array,
  framesPerSec: number,
  beatTimesSec: number[]
): number {
  const framesPerBucket = Math.round(framesPerSec);
  const bucketCount = Math.min(20, Math.floor(energy.length / framesPerBucket));
  if (bucketCount < 2) return 0;

  const bucketEnergy: number[] = [];
  for (let b = 0; b < bucketCount; b++) {
    let sum = 0;
    const start = b * framesPerBucket;
    for (let j = 0; j < framesPerBucket; j++) sum += energy[start + j];
    bucketEnergy.push(sum / framesPerBucket);
  }

  let bestBucket = 0;
  let bestJump = -Infinity;
  for (let b = 1; b < bucketCount; b++) {
    const jump = bucketEnergy[b] - bucketEnergy[b - 1];
    if (jump > bestJump) {
      bestJump = jump;
      bestBucket = b;
    }
  }

  const rawSecond = bestBucket; // bucket b starts at second b (1s buckets)
  const snapped = beatTimesSec.find((t) => t >= rawSecond);
  return snapped ?? rawSecond;
}
