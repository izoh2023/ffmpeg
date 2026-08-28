"""
Logo Detection — Color Masking (automation version)
=====================================================
Returns JSON with delogo coordinates. No output video.

Usage:
    python detect_logo.py --video /path/to/video.mp4

Output (stdout, JSON):
    {"x": 1142, "y": 28, "w": 118, "h": 116, "frame_w": 1920, "frame_h": 1080, "content_top": 140, "content_bottom": 940}

On failure:
    {"error": "reason"}

Arguments:
    --video       Path to input video
    --skip-secs   Seconds to skip into video for detection (default: 5)
    --search      Fraction of frame to search from top-right (default: 0.25)
    --hsv-lower   HSV lower bound H,S,V (default: 18,80,120)
    --hsv-upper   HSV upper bound H,S,V (default: 35,255,255)
    --min-area    Minimum blob area in px² (default: 100)
    --padding     Extra pixels around detected region (default: 8)
"""

import cv2
import numpy as np
import argparse
import sys
import json


def is_black_frame(frame, threshold=10):
    return frame.max() < threshold


def find_usable_frame(cap, fps, skip_secs=5, max_attempts=10):
    start_frame = int(fps * skip_secs)
    for attempt in range(max_attempts):
        seek = start_frame + int(fps * attempt)
        cap.set(cv2.CAP_PROP_POS_FRAMES, seek)
        ret, frame = cap.read()
        if not ret:
            break
        if not is_black_frame(frame):
            return frame
    return None


def detect_content_bounds(frame_bgr, black_threshold=16):
    """Find vertical bounds of actual content, skipping black bars top and bottom."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    content_top = 0
    for row in range(h):
        if gray[row, :].max() > black_threshold:
            content_top = row
            break

    content_bottom = h
    for row in range(h - 1, -1, -1):
        if gray[row, :].max() > black_threshold:
            content_bottom = row + 1
            break

    return content_top, content_bottom


def detect_by_color(frame_bgr, search_fraction, hsv_lower, hsv_upper, min_area, content_top, content_bottom):
    h, w = frame_bgr.shape[:2]

    content_h = content_bottom - content_top

    # Search full content height (logo may be anywhere vertically — e.g. bottom panel of v-stack)
    # but only a fraction of the width from the right edge
    roi_w = int(w * search_fraction)
    roi_h = content_h
    x_off = w - roi_w
    y_off = content_top

    roi     = frame_bgr[y_off:y_off + roi_h, x_off:x_off + roi_w]
    roi_hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    mask    = cv2.inRange(roi_hsv, hsv_lower, hsv_upper)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Filter contours by aspect ratio before picking largest
    # Logos are roughly square — reject anything too tall or too wide
    valid = []
    for c in contours:
        if cv2.contourArea(c) < min_area:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        aspect = bw / bh if bh > 0 else 0
        if 0.4 <= aspect <= 2.5:
            valid.append(c)

    if not valid:
        return None

    largest = max(valid, key=cv2.contourArea)
    x, y, bw, bh = cv2.boundingRect(largest)

    # Translate coordinates back to full frame space
    return (x + x_off, y + y_off, bw, bh)


def detect_with_fallback(frame, search_fraction, hsv_lower, hsv_upper, min_area, content_top, content_bottom):
    """Try detection with progressively looser parameters."""
    attempts = [
        # Attempt 1: caller-supplied params
        (search_fraction, hsv_lower, hsv_upper, min_area),
        # Attempt 2: wider HSV, lower min-area
        (search_fraction,
         np.array([10, 50, 80]),
         np.array([40, 255, 255]),
         50),
        # Attempt 3: wider search region
        (min(search_fraction * 1.5, 0.4),
         np.array([10, 50, 80]),
         np.array([40, 255, 255]),
         50),
    ]
    for s_frac, lower, upper, area in attempts:
        result = detect_by_color(frame, s_frac, lower, upper, area, content_top, content_bottom)
        if result:
            return result
    return None


def detect_across_frames(cap, fps, duration_secs, sample_times, search_fractions,
                         hsv_lower, hsv_upper, min_area):
    """Search several timestamps and progressively wider right-side regions."""
    color_attempts = [
        (hsv_lower, hsv_upper, min_area),
        (np.array([10, 50, 80]), np.array([40, 255, 255]), 50),
        (np.array([5, 35, 60]), np.array([45, 255, 255]), 40),
    ]

    for sample_time in sample_times:
        bounded_time = max(0.0, min(float(sample_time), max(duration_secs - 0.1, 0.0)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * bounded_time))
        ret, frame = cap.read()
        if not ret or is_black_frame(frame):
            continue

        frame_h, frame_w = frame.shape[:2]
        content_top, content_bottom = detect_content_bounds(frame)
        for search_fraction in search_fractions:
            for lower, upper, area in color_attempts:
                result = detect_by_color(
                    frame, search_fraction, lower, upper, area,
                    content_top, content_bottom,
                )
                if result:
                    return (*result, frame_w, frame_h, content_top, content_bottom)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video",      required=True)
    parser.add_argument("--skip-secs",  type=float, default=5.0,   dest="skip_secs")
    parser.add_argument("--search",     type=float, default=0.25)
    parser.add_argument("--hsv-lower",  default="18,80,120",       dest="hsv_lower")
    parser.add_argument("--hsv-upper",  default="35,255,255",      dest="hsv_upper")
    parser.add_argument("--min-area",   type=int,   default=100,   dest="min_area")
    parser.add_argument("--padding",    type=int,   default=32)
    args = parser.parse_args()

    hsv_lower = np.array([int(v) for v in args.hsv_lower.split(",")])
    hsv_upper = np.array([int(v) for v in args.hsv_upper.split(",")])

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(json.dumps({"error": f"Cannot open video: {args.video}"}))
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    fw  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh  = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration_secs = frame_count / fps if frame_count > 0 else max(args.skip_secs, 5.0)
    sample_times = list(dict.fromkeys([
        min(1.0, duration_secs * 0.1),
        min(args.skip_secs, duration_secs * 0.25),
        duration_secs * 0.5,
        duration_secs * 0.75,
    ]))
    search_fractions = list(dict.fromkeys([
        args.search,
        min(max(args.search * 2, 0.5), 0.75),
        0.75,
    ]))
    detected = detect_across_frames(
        cap, fps, duration_secs, sample_times, search_fractions,
        hsv_lower, hsv_upper, args.min_area,
    )
    cap.release()

    if detected is None:
        print(json.dumps({"error": "Logo not detected across sampled frames — check logo color or position"}))
        sys.exit(1)

    x, y, w, h, fw, fh, content_top, content_bottom = detected
    x = max(0, x - args.padding)
    y = max(0, y - args.padding)
    w = min(w + args.padding * 2, fw - x - 1)
    h = min(h + args.padding * 2, fh - y - 1)

    print(json.dumps({
        "x": x, "y": y, "w": w, "h": h,
        "frame_w": fw, "frame_h": fh,
        "content_top": content_top,
        "content_bottom": content_bottom,
    }))


if __name__ == "__main__":
    main()
