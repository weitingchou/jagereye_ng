from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import cv2


def save_image(filename, image, max_width=0):
    """Save image.

    Args:
        filename: The filename of the image to be saved.
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
        image = cv2.resize(image, (0, 0), fx=ratio, fy=ratio)
    cv2.imwrite(filename, image)
