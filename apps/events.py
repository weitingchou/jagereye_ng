from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import os
import time
import abc
from collections import deque

from jagereye_ng.io.streaming import VideoStreamWriter
from jagereye_ng.io.obj_storage import ObjectStorageClient
from jagereye_ng import logging


class EventVideoFrame(object):
    """A class used to store VideoFrame object and its event metadata

    Attributes:
        frame (VideoFrame obj): The raw VideoFrame object of the event.
        metadate (dict): The metadate of the frame for the event.
    """
    def __init__(self, frame, metadata=None):
        self._frame = frame
        self.metadata = metadata

    @property
    def image(self):
        return self._frame.image

    @property
    def timestamp(self):
        return self._frame.timestamp


class EventVideoWriter(object):
    """A class used to generate event video.

    Attributes:
        video_key (str): The key to represent the video in the object store.
        metadata_key (str): The key to represent the video metadata in the
            object store.
        timestamp (timestamp): The start timestamp of the video, it will be
            saved in the video metadata.
        metadata (dict): Base video metadata.
        fps (int): The fps of the output video.
        size (tuple): The size of the output video. The format is
            (width, height).
    """
    def __init__(self, video_key, metadata_key, timestamp, metadata, fps, size):
        self._writer = VideoStreamWriter()
        self._video_key = video_key
        self._metadata_key = metadata_key
        self._tmp_filepath = os.path.join("/tmp", self._video_key)

        # Create the temporary folder, for video and metadata file, if it does
        # not exist.
        tmp_dir = os.path.dirname(self._tmp_filepath)
        if not os.path.exists(tmp_dir):
            os.makedirs(tmp_dir)

        self._metadata = {"fsp": fps, "start": timestamp}
        try:
            self._event_name = metadata["event_name"]
            event_custom = metadata["event_custom"]
            self._metadata[self._event_name] = {
                "frames": [],
                "custom": event_custom
            }
        except KeyError:
            raise

        try:
            self._writer.open(self._tmp_filepath, fps, size)
        except RuntimeError:
            raise

        # Connect to Object Store service
        self._obj_store = ObjectStorageClient()
        self._obj_store.connect()

    def _write(self, frame):
        self._writer.write(frame)
        self._metadata[self._event_name]["frames"].append(frame.metadata)

    def write(self, frames):
        if isinstance(frames, list):
            for frame in frames:
                self._write(frame)
        else:
            self._write(frames)

    def end(self, timestamp=None):
        self._writer.end()
        self._metadata[self._event_name]["end"] = float(
            timestamp if timestamp is not None else time.time())

        # TODO: Add error handling for failure of writing to object store.
        # Write out video file to object store.
        self._obj_store.save_file_obj(self._video_key, self._tmp_filepath)
        # Remove the temporary video file.
        os.remove(self._tmp_filepath)
        logging.info("Saved video: {}".format(self._video_key))

        # Write out video metadata to object store.
        self._obj_store.save_json_obj(self._metadata_key, self._metadata)
        logging.info("Saved video metadata: {}".format(self._metadata_key))


class EventVideoPolicy():
    """A metaclass used to define the event video policy interface.

    User should inherent this class to define his own policy object to control
    the flow EventVideoAgent of recording video.
    """

    START_RECORDING = 0
    STOP_RECORDING = 1

    @abc.abstractmethod
    def compute(self, frames):
        pass


class EventVideoAgent(object):
    """A class used to control event video generation with a policy.

    Attributes:
        policy (object): The policy to control when the agent to start/stop
            recording.
        event_metadata (dict): The base of video metadata. It's a dict with
            following keys:
                event_name: The event name of the video.
                event_custom: The information you want to insert into the video
                    metadata section of the event_name.
        obj_key_prefix (str): The key prefix of the video and metadata.
        frame_size (tuple): The size of the input image frame with format
            of (width, height).
        video_format (str): The output video format.
        fps (int): The output video fps.
        history_len (int): The length, in seconds, of frame history queue. This
            determines when the agent starts to record before policy returning
            action "START_RECORDING".
    """

    STATE_RECORDING = 0
    STATE_PASSTHROUGH = 1

    def __init__(self,
                 policy,
                 event_metadata,
                 obj_key_prefix,
                 frame_size,
                 video_format="mp4",
                 fps=15,
                 history_len=3):
        """Initialize a EventVideoAgent object."""
        self._policy = policy
        self._obj_key_prefix = obj_key_prefix
        self._frame_size = frame_size
        self._event_metadata = event_metadata
        self._video_format = video_format
        self._fps = fps

        max_history_frames = self._fps * history_len
        self._history_q = deque(maxlen=max_history_frames)
        self._current_writer = None
        self._state = EventVideoAgent.STATE_PASSTHROUGH

    def process(self, frame):
        """Process the frame to generate event video."""

        class AgentEvent(object):
            __slots__ = ["action", "content"]
            def __init__(self, action, content=None):
                self.action = action
                self.content = content

        agent_event = None

        # Determine what action needs to be taken for the incoming frame
        # according to the user-defined policy.
        action = self._policy.compute(frame)
        if self._state == EventVideoAgent.STATE_PASSTHROUGH:
            self._history_q.append(frame)
            if action == EventVideoPolicy.START_RECORDING:
                timestamp = frame.timestamp
                filename = os.path.join(self._obj_key_prefix,
                                        "{}".format(timestamp))
                video_key = "{}.{}".format(filename, self._video_format)
                metadata_key = "{}.json".format(filename)
                self._current_writer = EventVideoWriter(
                    video_key,
                    metadata_key,
                    timestamp,
                    self._event_metadata,
                    self._fps,
                    self._frame_size)

                # Flush out history queue to event video
                history = self._history_q.copy()
                for _ in range(len(history)):
                    self._current_writer.write(history.popleft())
                self._history_q.clear()

                agent_event = AgentEvent(action, {"video_key": video_key,
                                                  "metadata_key": metadata_key,
                                                  "timestamp": timestamp})
                self._state = EventVideoAgent.STATE_RECORDING
        elif self._state == EventVideoAgent.STATE_RECORDING:
            self._current_writer.write(frame)
            if action == EventVideoPolicy.STOP_RECORDING:
                self._current_writer.end(frame.timestamp)
                agent_event = AgentEvent(action)
                self._state = EventVideoAgent.STATE_PASSTHROUGH

        return agent_event

    def release(self):
        if self._state == EventVideoAgent.STATE_RECORDING:
            self._current_writer.end()
        self._history_q.clear()
