from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import cv2
import numpy as np

from jagereye_ng.io import obj_storage


def shrink_image(image, max_width=0):
    """Shrink image to a smaller size.

    Args:
        image: A 3 dimensional numpy array of the image to be saved.
        max_width (int): The maximum width of image. If the given image
            width is larger than max_width, the width of image file will be
            shrunk to max_width, and the height will be shrunk proportionally.
            When max_width <= 0, the maximum width of image is unlimited.
            Defaults to 0.
    """
    orig_width = image.shape[1]
    if max_width > 0 and orig_width > max_width:
        ratio = max_width / orig_width
        shrunk_image = cv2.resize(image, (0, 0), fx=ratio, fy=ratio)
    else:
        shrunk_image = image.copy()

    return shrunk_image


def draw_region(image, region, color, alpha=0.5):
    """Draw a region on a image.

    Args:
        image (ndarray): The image to draw.
        region (tuple of tuple): The region to be drawn onto the image. It's a
            tuple list of tuple, such as ((X1, Y1), (X2, Y2), ...), the point in
            the list should be type of `int32`.
        color (tuple): The region color of format (B, G, R).
        alpha (float): The level for alpha blending. Default to 0.5.

    Returns:
        The drawn image.
    """
    drawn_image = image.copy()
    overlay = image.copy()
    cv2.fillPoly(overlay, np.array([region], np.int32), color)
    cv2.addWeighted(overlay, alpha, image, 1 - alpha, 0, drawn_image)
    return drawn_image
