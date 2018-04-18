from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import cv2
import numpy as np


def detect_motion(frames, sensitivity=80):
    """Detect motion between frames.

    Args:
        frames: A list of VideoFrame objects.
        sensitivity: The sensitivity of motion detection, range from 1
                     to 100. Defaults to 80.
    Returns:
        The frames that have being detected with motion.
    """
    sensitivity_clamp = max(1, min(sensitivity, 100))
    threshold = (100 - sensitivity_clamp) * 0.05
    num_frames = len(frames)
    if num_frames < 1:
        return []

    results = {"frames": [], "index": []}

    def add_to_results(frame, index):
        results["frames"].append(frame)
        results["index"].append(index)

    add_to_results(frames[0], 0)
    last = cv2.cvtColor(frames[0].image, cv2.COLOR_BGR2GRAY)
    for i in range(1, num_frames):
        current = cv2.cvtColor(frames[i].image, cv2.COLOR_BGR2GRAY)
        res = cv2.absdiff(last, current)
        # Remove the noise and do the threshold.
        res = cv2.blur(res, (5, 5))
        res = cv2.morphologyEx(res, cv2.MORPH_OPEN, None)
        res = cv2.morphologyEx(res, cv2.MORPH_CLOSE, None)
        ret, res = cv2.threshold(res, 10, 255, cv2.THRESH_BINARY_INV)  # pylint: disable=unused-variable
        # Count the number of black pixels.
        num_black = np.count_nonzero(res == 0)
        # Calculate the image size.
        im_size = current.shape[1] * current.shape[0]
        # Calculate the average of black pixel in the image.
        avg_black = (num_black * 100.0) / im_size
        # Detect moving by testing whether the average of black exceeds the
        # threshold or not.
        if avg_black >= threshold:
            add_to_results(frames[i], i)
        last = current
    return results
