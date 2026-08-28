import unittest
from unittest.mock import patch

import numpy as np

import detect_logo


class FakeCapture:
    def __init__(self, frames):
        self.frames = frames
        self.position = 0

    def set(self, _property, value):
        self.position = int(value)

    def read(self):
        frame = self.frames.get(self.position)
        return (frame is not None, frame)


class LogoSamplingTest(unittest.TestCase):
    def test_detection_checks_multiple_timestamps_and_wider_search(self):
        frame = np.full((100, 200, 3), 255, dtype=np.uint8)
        cap = FakeCapture({50: frame})

        with patch.object(detect_logo, "detect_by_color", side_effect=[None, None, (20, 10, 30, 30)]) as mocked:
            result = detect_logo.detect_across_frames(
                cap,
                fps=10,
                duration_secs=10,
                sample_times=[1, 5],
                search_fractions=[0.25, 0.75],
                hsv_lower=np.array([18, 80, 120]),
                hsv_upper=np.array([35, 255, 255]),
                min_area=100,
            )

        self.assertEqual(result[:4], (20, 10, 30, 30))
        self.assertEqual(mocked.call_count, 3)


if __name__ == "__main__":
    unittest.main()
