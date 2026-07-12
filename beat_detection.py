"""
Beat Detection — Librosa (automation version)
================================================
Analyzes a music file and returns beat timestamps + tempo as JSON.

Usage:
    python beat_detection.py --audio /path/to/music.mp3

Output (stdout, JSON):
    {"bpm": 118.5, "beatTimesSec": [0.52, 1.03, ...], "suggestedTrimStart": 12.27}

On failure:
    {"error": "reason"}

Arguments:
    --audio             Path to input audio file
    --cap-seconds       Max seconds of audio to analyze (default: 120)
    --trim-search-secs  Seconds to search for "the drop" when picking
                         suggestedTrimStart (default: 20)
"""

import argparse
import json
import sys

import librosa
import numpy as np


def pick_trim_start(y: np.ndarray, sr: int, beat_times: list, search_secs: float) -> float:
    """
    Finds the biggest jump in per-second RMS energy within the first
    `search_secs` seconds (a reasonable proxy for "the drop"/where the
    track picks up), then snaps that timestamp to the nearest beat at or
    after it so a scene cut landing there feels intentional.
    """
    search_samples = int(min(len(y), search_secs * sr))
    if search_samples < sr:
        return 0.0

    hop_length = 512
    rms = librosa.feature.rms(y=y[:search_samples], hop_length=hop_length)[0]
    frames_per_sec = sr / hop_length
    bucket_size = max(1, int(round(frames_per_sec)))
    bucket_count = len(rms) // bucket_size
    if bucket_count < 2:
        return 0.0

    bucket_energy = [
        float(np.mean(rms[b * bucket_size:(b + 1) * bucket_size]))
        for b in range(bucket_count)
    ]

    best_bucket, best_jump = 0, -np.inf
    for b in range(1, bucket_count):
        jump = bucket_energy[b] - bucket_energy[b - 1]
        if jump > best_jump:
            best_jump, best_bucket = jump, b

    raw_second = float(best_bucket)  # ~1s per bucket
    snapped = next((t for t in beat_times if t >= raw_second), None)
    return snapped if snapped is not None else raw_second


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--cap-seconds", type=float, default=120.0)
    parser.add_argument("--trim-search-secs", type=float, default=20.0)
    args = parser.parse_args()

    try:
        y, sr = librosa.load(args.audio, sr=None, mono=True, duration=args.cap_seconds)
        if y.size == 0:
            print(json.dumps({"error": "Empty audio signal"}))
            sys.exit(0)

        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

        suggested_trim_start = pick_trim_start(y, sr, beat_times, args.trim_search_secs)

        print(json.dumps({
            "bpm": round(bpm, 2),
            "beatTimesSec": beat_times,
            "suggestedTrimStart": suggested_trim_start,
        }))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(0)


if __name__ == "__main__":
    main()
