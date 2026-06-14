import cv2
import sys
import json
import numpy as np
import os

video_path = sys.argv[1]
crop_x, crop_y, crop_w, crop_h = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])

CASCADE_PATHS = [
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
    "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
    "/usr/share/opencv/haarcascades/haarcascade_frontalface_default.xml",
    "/usr/lib/python3/dist-packages/cv2/data/haarcascade_frontalface_default.xml",
]
cascade_path = next((p for p in CASCADE_PATHS if os.path.exists(p)), None)

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS) or 25
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
total_secs = total_frames / fps
frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

def try_detect_all(roi):
    if not cascade_path:
        return []
    cascade = cv2.CascadeClassifier(cascade_path)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    best = []
    for scale, neighbors in [(1.05, 3), (1.08, 4), (1.1, 5)]:
        faces = cascade.detectMultiScale(gray, scaleFactor=scale, minNeighbors=neighbors, minSize=(30, 30))
        if len(faces) >= 2:
            return list(faces)
        if len(faces) > len(best):
            best = list(faces)
    return best

def find_divider_x(region_gray, crop_w):
    """Find the actual vertical divider/gap between panels using column brightness."""
    kernel = np.ones(15) / 15
    col_means = np.mean(region_gray, axis=0)
    smoothed = np.convolve(col_means, kernel, mode='same')
    # Search center 60%
    s = int(crop_w * 0.20)
    e = int(crop_w * 0.80)
    local_min = int(np.argmin(smoothed[s:e])) + s
    return local_min  # relative to crop_x

seek_points = np.linspace(total_secs * 0.05, total_secs * 0.90, 20)

left_cy_samples  = []
right_cy_samples = []
divider_x_samples = []
best_frame_gray = None

for seek in seek_points:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(seek * fps))
    for _ in range(5):
        ret, frame = cap.read()
        if not ret:
            break
        roi = frame[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]
        gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

        # Always accumulate divider samples
        divider_x_samples.append(find_divider_x(gray_roi, crop_w))
        if best_frame_gray is None:
            best_frame_gray = gray_roi

        faces = try_detect_all(roi)
        if len(faces) >= 2:
            faces_sorted = sorted(faces, key=lambda f: f[0])
            left  = faces_sorted[0]
            right = faces_sorted[-1]
            left_cy_samples.append(int(left[1]  + left[3]  / 2) + crop_y)
            right_cy_samples.append(int(right[1] + right[3] / 2) + crop_y)
            break

cap.release()

# Compute stable divider x in full-frame coords
divider_rel = int(np.median(divider_x_samples)) if divider_x_samples else crop_w // 2

# Determine actual panel boundaries by finding the dark/bright gap edges
# Walk left and right from divider to find where content resumes
if best_frame_gray is not None:
    col_means = np.mean(best_frame_gray, axis=0)
    threshold = np.mean(col_means) * 0.6  # below 60% of avg = divider region

    # Walk left from divider
    left_edge = divider_rel
    for i in range(divider_rel, max(0, divider_rel - 80), -1):
        if col_means[i] > threshold:
            left_edge = i
            break

    # Walk right from divider
    right_edge = divider_rel
    for i in range(divider_rel, min(crop_w, divider_rel + 80)):
        if col_means[i] > threshold:
            right_edge = i
            break
else:
    left_edge  = divider_rel
    right_edge = divider_rel

# split_x is the clean boundary — right panel starts at right_edge, left panel ends at left_edge
split_x_in_frame = crop_x + right_edge
left_w_clean     = left_edge   # width of left panel relative to crop_x
right_x_clean    = crop_x + right_edge
right_w_clean    = crop_w - right_edge

left_cy  = int(np.median(left_cy_samples))  if left_cy_samples  else -1
right_cy = int(np.median(right_cy_samples)) if right_cy_samples else -1

print(json.dumps({
    "found": len(left_cy_samples) >= 2,
    "frame_w": frame_w,
    "frame_h": frame_h,
    "samples": len(left_cy_samples),
    # Left panel: starts at crop_x, width = left_w_clean
    "left": {
        "x": crop_x,
        "w": left_w_clean,
        "cy": left_cy,
    },
    # Right panel: starts at right_x_clean
    "right": {
        "x": right_x_clean,
        "w": right_w_clean,
        "cy": right_cy,
    },
    "split_x": split_x_in_frame,
}))