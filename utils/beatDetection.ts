import { spawn } from "child_process";
import path from "path";

export interface BeatAnalysis {
  bpm: number;
  /** Absolute timestamps (seconds, from the start of the source file) where a beat was detected. */
  beatTimesSec: number[];
  /** Best-guess point to trim into — where the track's energy first jumps, snapped to a beat. */
  suggestedTrimStart: number;
}

const EMPTY_ANALYSIS: BeatAnalysis = { bpm: 0, beatTimesSec: [], suggestedTrimStart: 0 };

/**
 * Beat detector — delegates to beat_detection.py (Librosa), following the
 * same spawn("python3", [...]) + JSON-on-stdout convention as
 * detect_logo.py / face_center.py. Never rejects: a missing file, a bad
 * decode, or a script crash all resolve to the empty analysis so the
 * render falls back to its original fixed-timing animations instead of
 * failing the whole job.
 */
export function detectBeats(audioPath: string): Promise<BeatAnalysis> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), "beat_detection.py");
    const proc = spawn("python3", [scriptPath, "--audio", audioPath]);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", () => {
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          console.warn(`[beatDetection] ${result.error}`);
          return resolve(EMPTY_ANALYSIS);
        }
        resolve({
          bpm: Number(result.bpm) || 0,
          beatTimesSec: Array.isArray(result.beatTimesSec) ? result.beatTimesSec : [],
          suggestedTrimStart: Number(result.suggestedTrimStart) || 0,
        });
      } catch {
        console.warn(`[beatDetection] Failed to parse beat_detection.py output: ${stderr || stdout}`);
        resolve(EMPTY_ANALYSIS);
      }
    });

    proc.on("error", (err) => {
      console.warn(`[beatDetection] Failed to spawn beat_detection.py: ${err.message}`);
      resolve(EMPTY_ANALYSIS);
    });
  });
}
