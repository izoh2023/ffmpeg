import cv2
import sys
import json
import numpy as np

video_path = sys.argv[1]
crop_x, crop_y, crop_w, crop_h = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS) or 25
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
total_secs = total_frames / fps

# Sample evenly across video, skipping first/last 5%
sample_points = np.linspace(total_secs * 0.05, total_secs * 0.95, 12)
col_means_accum = np.zeros(crop_w)
samples_used = 0

for sec in sample_points:
    frame_idx = int(sec * fps)
    if frame_idx >= total_frames:
        continue
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    if not ret:
        continue
    region = frame[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    col_means_accum += np.mean(gray, axis=0)
    samples_used += 1

cap.release()

if samples_used == 0:
    print(json.dumps({"split_x": crop_x + crop_w // 2}))
    sys.exit(0)

col_means = col_means_accum / samples_used

# Smooth to reduce noise
kernel = np.ones(15) / 15
smoothed = np.convolve(col_means, kernel, mode='same')

# Search in center 40%
search_start = int(crop_w * 0.30)
search_end = int(crop_w * 0.70)
center_smoothed = smoothed[search_start:search_end]

local_min = int(np.argmin(center_smoothed)) + search_start
split_x = crop_x + local_min

print(json.dumps({
    "split_x": split_x,
    "local_min": local_min,
    "crop_w": crop_w,
    "samples": samples_used
}))