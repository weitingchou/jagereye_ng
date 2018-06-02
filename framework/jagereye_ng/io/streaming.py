from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import os
import time
import threading
import signal
import cv2
from queue import Queue
from collections import deque
from urllib.parse import urlparse

from jagereye_ng.util import logging


DEFAULT_STREAM_BUFFER_SIZE = 64     # frames
DEFAULT_FPS = 15


class ConnectionError(Exception):
    pass


class EndOfVideoError(Exception):
    pass


class TaskTimeoutError(Exception):
    pass


def _is_livestream(url):
    """Check whether the source is a livestream or not.

    We check the protocol of the source url to determine whether
    it's a livestream, since currently we only support "RTSP",
    source url which not starts with "rtsp://" would be consider
    as not an livestream source.

    Returns:
        True if it's a livestream source and false otherwise.
    """
    # XXX: Not a very robust way for checking the source protocol.
    return urlparse(url).scheme.lower() == "rtsp"


def run_with_timeout(timeout, func, *args, **kwargs):
    """Execute a task with a timeout.

    Args:
        timeout (float): The timeout value.
        func (function): The task function to be executed.

    Returns:
        The task result.

    Raises:
        An TaskTimeoutError exception if the execution of the task exceeded
        the timeout, otherwise, raises the task exceptions, if any.
    """

    class Job(threading.Thread):
        def __init__(self, func, *args, **kwargs):
            threading.Thread.__init__(self)
            self.daemon = True
            self._func = func
            self._args = args
            self._kwargs = kwargs
            self.result = None
            self.exception = None

        def run(self):
            try:
                self.result = self._func(*self._args, **self._kwargs)
            except Exception as e:
                self.exception = e

        def terminate(self):
            signal.pthread_kill(self.ident, 0)

    job = Job(func, *args, **kwargs)
    job.start()
    job.join(timeout=timeout)

    if job.is_alive():
        # job's timeout has happened, cancel it and notify the caller
        job.terminate()
        raise TaskTimeoutError("The task has exceeded the timeout.")
    elif job.exception is not None:
        raise job.exception
    else:
        return job.result


class VideoFrame(object):
    def __init__(self, image_raw, timestamp=None):
        self.image = image_raw
        if timestamp is None:
            self.timestamp = time.time()
        else:
            self.timestamp = timestamp


class StreamReaderThread(threading.Thread):
    def __init__(self,
                 reader,
                 queue,
                 stop_event,
                 cap_interval,
                 is_livestream):
        super(StreamReaderThread, self).__init__()
        self._reader = reader
        self._queue = queue
        self._stop_event = stop_event
        self._cap_interval = cap_interval / 1000.0
        self._is_livestream = is_livestream
        self._exception = None

    def run(self):
        try:
            while not self._stop_event.is_set():
                success, image = self._reader.read()
                if not success:
                    if self._is_livestream:
                        raise ConnectionError()
                    else:
                        raise EndOfVideoError()
                timestamp = time.time()
                self._queue.appendleft(VideoFrame(image, timestamp))
                time.sleep(self._cap_interval)
            logging.info("Reader thread is terminated")
        except Exception as e:
            logging.error(str(e))
            self._exception = e

    def get_exception(self):
        return self._exception


class VideoStreamReader(object):
    """The video stream reader.

    The reader to read frames from a video stream source. The source can be a
    video file or a live stream such as RTSP, Motion JPEG. Each captured frame
    will be stored as a VideoFrame object with an image tensor and the
    timestamp of which the frame been captured.

    The "image" tensor is a 3-dimensional numpy `ndarray` whose type is uint8
    and the shape format is:
    1. Image height.
    2. Image width.
    3. Number of channels, which is usually 3.

    The "timestamp" tensor is a 0-dimensional numpy `ndarray` whose type is
    string.
    """

    def __init__(self, buffer_size=DEFAULT_STREAM_BUFFER_SIZE):
        """Initialize a `VideoStreamReader` object.

        Args:
            buffer_size: The maximum size to buffering the video stream.
        """
        self._reader = cv2.VideoCapture()
        self._queue = deque(maxlen=buffer_size)
        self._stop_event = threading.Event()
        self._video_info = {}

    def open(self, src, timeout=15, fps=DEFAULT_FPS):
        logging.info("Opening video source: {}".format(src))

        assert not self._reader.isOpened(), ("Perhaps you call open() twice"
                                             " by accident?")

        error_message = "Can't open video source from {}".format(src)

        # Open video source
        try:
            if not run_with_timeout(timeout, self._reader.open, src):
                raise ConnectionError(error_message)
        except TaskTimeoutError:
            logging.error("Timeout error occurred when opening video source"
                          " from {}".format(src))
            raise ConnectionError(error_message)

        # Get video information
        success, image = self._reader.read()
        if not success:
            raise ConnectionError(error_message)
        height, width, _ = image.shape
        self._video_info["frame_size"] = (width, height)

        # Start reader thread
        self._stop_event.clear()
        capture_interval = 1000.0 / fps
        logging.info("Starting reader thread")
        self._thread = StreamReaderThread(self._reader,
                                          self._queue,
                                          self._stop_event,
                                          capture_interval,
                                          _is_livestream(src))
        self._thread.daemon = True
        self._thread.start()

    def release(self):
        self._stop_event.set()
        if hasattr(self, "_thread"):
            self._thread.join()
        self._reader.release()
        self._queue.clear()

    def get_video_info(self):
        return self._video_info

    def _read_all(self):
        return [self._queue.pop() for _ in range(len(self._queue))]

    def _read(self, batch_size):
        return [self._queue.pop() for _ in range(batch_size)]

    def read(self, batch_size=1):
        """The routine of video stream capturer capturation.

        Returns:
            A list of captured VideoFrame objects. The length of the list
            is determined by the `batch_size`.

        Raises:
            ConnectionError: Raise if the livestream connection is
                disconnected.
            EndOfVideoError: Raise if the file stream reaches the end.
        """
        cur_q_size = len(self._queue)
        while cur_q_size < batch_size:
            if self._thread.get_exception() is not None:
                break
            time.sleep(0.1)
            cur_q_size = len(self._queue)

        exception = self._thread.get_exception()
        if isinstance(exception, EndOfVideoError):
            if cur_q_size == 0:
                raise EndOfVideoError()
            elif cur_q_size <= batch_size:
                data = self._read_all()
            else:
                data = self._read(batch_size)
        elif isinstance(exception, ConnectionError):
            raise ConnectionError()
        else:
            # XXX: In this case we are assuming that everything is fine,
            #      and current queue size should greater than the batch
            #      size.
            data = self._read(batch_size)
        return data


class StreamWriterThread(threading.Thread):
    def __init__(self, writer, queue, stop_event):
        super(StreamWriterThread, self).__init__()
        self._writer = writer
        self._queue = queue
        self._stop_event = stop_event
        self._exception = None

    def run(self):
        try:
            while True:
                if self._queue.empty():
                    if self._stop_event.is_set():
                        break
                    else:
                        time.sleep(0.01)
                        continue
                frame = self._queue.get()
                self._writer.write(frame.image)
                self._queue.task_done()
            logging.info("Writer thread is terminated")
        except Exception as e:
            logging.error(str(e))
            self._exception = e

    def get_exception(self):
        return self._exception


class VideoStreamWriter(object):
    def __init__(self):
        self._writer = cv2.VideoWriter()
        self._queue = Queue()
        self._stop_event = threading.Event()

    def open(self, filename, fps, size):
        if self._writer.isOpened():
            raise RuntimeError("Stream is already opened")

        _, ext = os.path.splitext(filename)
        if ext == ".mp4":
            filename = ('appsrc ! autovideoconvert ! x264enc ! matroskamux !'
                         ' filesink location={}'.format(filename))
            fourcc = 0
        else:
            fourcc = cv2.VideoWriter_fourcc(*'XVID')

        if not self._writer.open(filename, fourcc, fps, size):
            raise RuntimeError("Can't open video file {}"
                               .format(filename))

        self._stop_event.clear()

        logging.info("Starting writer thread")
        self._thread = StreamWriterThread(self._writer,
                                          self._queue,
                                          self._stop_event)
        self._thread.daemon = True
        self._thread.start()

    def end(self):
        try:
            self._stop_event.set()
            if hasattr(self, "_thread") and self._thread.is_alive():
                if not self._queue.empty():
                    self._queue.join()
                self._thread.join()
            self._writer.release()
        except Exception as e:
            logging.error(str(e))

    def write(self, frames):
        if isinstance(frames, list):
            for frame in frames:
                self._queue.put(frame)
        else:
            self._queue.put(frames)
