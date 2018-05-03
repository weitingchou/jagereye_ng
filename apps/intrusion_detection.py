from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import os
import time
import cv2
import json
from collections import deque
from dask.distributed import get_client
from shapely import geometry

from jagereye_ng import image as im
from jagereye_ng import gpu_worker
from jagereye_ng.io import obj_storage
from jagereye_ng.io.streaming import VideoStreamWriter
from jagereye_ng import logging


def load_category_index(path):
    with open(path, "r") as f:
        lines = f.readlines()
    result = dict()
    for line in lines:
        record = line.strip().split(" ")
        result[int(record[0])] = record[1]
    return result


class EndOfMarginError(Exception):
    pass


class IntrusionDetectionEvent(object):
    def __init__(self, video, thumbnail, metadata, triggered, timestamp=None):
        self.name = "intrusion_detection.alert"
        self.video = video
        self.thumbnail = thumbnail
        self.metadata = metadata
        self.triggered = triggered
        self.timestamp = timestamp if timestamp is not None else time.time()

    @property
    def content(self):
        content = {
            "video": self.video,
            "thumbnail": self.thumbnail,
            "metadata": self.metadata,
            "triggered": self.triggered
        }
        return content

    def __str__(self):
        return ("name: {}, video: {}, thumbnail: {}, metadata: {}, "
                "triggered: {}, timestamp: {}".format(
                    self.name,
                    self.video,
                    self.thumbnail,
                    self.metadata,
                    self.triggered,
                    self.timestamp))


class EventVideoFrames(object):
    def __init__(self, raw, motion, catched, mode):
        self.raw = raw
        self.metadata = self._gen_metadata(motion, catched, mode)
        self.length = len(raw)

        triggered = set()
        for m in self.metadata:
            if "labels" in m:
                for label in m["labels"]:
                    triggered.add(label)
        self.triggered = list(triggered)

    def _gen_metadata(self, motion, catched, mode):
        metadata = []
        for i in range(len(self.raw)):
            try:
                matched = catched[motion["index"].index(i)].copy()
            except ValueError:
                # TODO: For non-catched case should insert None
                metadata.append({"bboxes": [], "scores": [], "labels": [], "mode": mode})
            else:
                matched.update({"mode": mode})
                metadata.append(matched)
        return metadata

class EventVideoWriter(object):

    EVENT_NORMAL_COLOR = (139, 195, 74)
    EVENT_ALERT_COLOR = (34, 87, 255)

    def __init__(self,
                 obj_name,
                 obj_key_prefix,
                 video_format,
                 roi,
                 fps,
                 size,
                 back_margin,
                 max_margin):
        self._roi = roi
        self._max_margin = max_margin
        self._writer = VideoStreamWriter()

        self.video_key = os.path.join(obj_key_prefix, "{}.{}".format(obj_name, video_format))
        self.metadata_key = os.path.join(obj_key_prefix, "{}.json".format(obj_name))
        self.thumbnail_key = os.path.join(obj_key_prefix, "{}.jpg".format(obj_name))

        self._tmp_video_path = os.path.join('/tmp', self.video_key)

        # Create the temporary folder for video if it does not exist.
        tmp_video_dir = os.path.dirname(self._tmp_video_path)
        if not os.path.exists(tmp_video_dir):
            os.makedirs(tmp_video_dir)

        try:
            self._writer.open(self._tmp_video_path, fps, size)
        except RuntimeError:
            raise

        self._front_margin_counter = 0
        self._metadata = {
            "intrusion_detection": {
                "frames": [],
                "custom": {"roi": roi}
            },
            "fps": fps
        }

        # Flush out back margin queue
        for i in range(len(back_margin)):
            ev_frames = back_margin.popleft()
            if i == 0:
                self._metadata["start"] = float(ev_frames.raw[0].timestamp)
            self._writer.write(ev_frames.raw)
            self._metadata["intrusion_detection"]["frames"].extend(
                ev_frames.metadata)

    def reset_front_margin(self):
        self._front_margin_counter = 0

    def write(self, ev_frames, thumbnail=False):
        self._writer.write(ev_frames.raw)
        self._metadata["intrusion_detection"]["frames"].extend(
            ev_frames.metadata)
        if thumbnail:
            drawn_image = im.draw_region(ev_frames.raw[0].image,
                                         self._roi,
                                         EventVideoWriter.EVENT_ALERT_COLOR,
                                         0.4)
            shrunk_image = im.shrink_image(drawn_image)
            obj_storage.save_image_obj(self.thumbnail_key, shrunk_image)
            logging.info("Saved thumbnail {}".format(self.thumbnail_key))
        self._front_margin_counter += ev_frames.length
        if self._front_margin_counter >= self._max_margin:
            self._metadata["end"] = float(ev_frames.raw[-1].timestamp)
            self.end()
            raise EndOfMarginError()

    def end(self):
        self._writer.end()

        # Write out video to object storage.
        obj_storage.save_file_obj(self.video_key, self._tmp_video_path)
        os.remove(self._tmp_video_path)
        logging.info("Saved video {}".format(self.video_key))

        # Write out video metadata to object storage.
        obj_storage.save_json_obj(self.metadata_key, self._metadata)
        logging.info("Saved metadata {}".format(self.metadata_key))


class EventVideoAgent(object):
    def __init__(self,
                 obj_key_prefix,
                 frame_size,
                 roi,
                 video_format,
                 fps,
                 margin):
        self._obj_key_prefix = obj_key_prefix
        self._frame_size = frame_size
        self._roi = roi
        self._video_format = video_format
        self._fps = fps

        self._max_margin_in_frames = self._fps * margin
        self._back_margin_q = deque(maxlen=self._max_margin_in_frames)

    def create(self, obj_name):
        if not isinstance(obj_name, str):
            obj_name = str(obj_name)
        try:
            # Create video writer
            writer = EventVideoWriter(
                obj_name,
                self._obj_key_prefix,
                self._video_format,
                self._roi,
                self._fps,
                self._frame_size,
                self._back_margin_q.copy(),
                self._max_margin_in_frames)
        except RuntimeError as e:
            logging.error(str(e))
            raise
        else:
            return writer

    def append_back_margin_queue(self, ev_frames):
        self._back_margin_q.append(ev_frames)

    def clear_back_margin_queue(self):
        self._back_margin_q.clear()

    def release(self):
        self.clear_back_margin_queue()


class IntrusionDetector(object):

    STATE_NORMAL = 0
    STATE_ALERT_START = 1
    STATE_ALERTING = 2

    def __init__(self,
                 anal_id,
                 roi,
                 triggers,
                 frame_size,
                 detect_threshold=0.25):
        """ Create a new IntrusionDetector instance.

        Args:
            anal_id (string): The ID of the analyzer that this detector attached
                for.
            roi (list of object): The region of interest with format of a list
                point objects, such as [{"x": 1, "y":1}, {"x": 2, "y": 2}, ...]
            triggers (list of string): The target of interest.
            frame_size (tuple): The frame size of input image frames with format
                (width, height).
            detect_threshold (number): The threshold of the detected object
                score.

        """
        try:
            # Get Dask client
            self._client = get_client()
        except ValueError:
            raise RuntimeError("Should connect to Dask scheduler before"
                               " initializing this object")

        self._roi = tuple([(r["x"], r["y"]) for r in roi])
        self._roi_polygon = geometry.Polygon(self._roi)
        self._triggers = triggers
        self._frame_size = frame_size
        self._detect_threshold = detect_threshold
        self._category_index = load_category_index("./coco.labels")
        self._state = IntrusionDetector.STATE_NORMAL

        obj_key_prefix = os.path.join("intrusion_detection", anal_id)
        ev_options = {
            "obj_key_prefix": obj_key_prefix,
            "frame_size": frame_size,
            "roi": self._roi,
            "video_format": "mp4",
            "fps": 15,
            "margin": 3
        }
        self._event_video_agent = EventVideoAgent(**ev_options)
        self._current_writer = None
        self._current_event = None
        logging.info("Created an IntrusionDetector (roi: {}, triggers: {}"
                     ", detect_threshold: {})".format(
                         self._roi,
                         self._triggers,
                         self._detect_threshold))

    def _is_in_roi(self, bbox, threshold=0.0):
        """Check whether a bbox is in the roi or not.

        Args:
            bbox (tuple): The bounding box of format:
                xmin (int): The left position.
                ymin (int): The top position.
                xmax (int): The right position.
                ymax (int): The bottom postion.
            threshold: The overlap threshold.

        Returns:
            True if bbox is in the roi and false otherwise.
        """
        (xmin, ymin, xmax, ymax) = bbox
        obj_polygon = geometry.Polygon([[xmin, ymin], [xmax, ymin],
                                        [xmax, ymax], [xmin, ymax]])
        overlap_area = self._roi_polygon.intersection(obj_polygon).area
        return overlap_area > threshold

    def _check_intrusion(self, detections):
        """Check if the detected objects is an intrusion event.

        Args:
            detections: A list of object detection result objects, each a
                object of format (bboxes, scores, classes, num_detctions).

        Returns:
            A list of tuple list that specifies the triggered detections,
            each a tuple list of format [(label, detect_index), ...].
        """
        width, height = self._frame_size

        results = []
        for i in range(len(detections)):
            (bboxes, scores, classes, num_candidates) = detections[i]

            in_roi_cands = {}
            for j in range(int(num_candidates[0])):
                # Check if score passes the threshold.
                if scores[0][j] < self._detect_threshold:
                    continue
                # Check if the object in in the trigger list.
                # XXX: Is it posssible to generate index that is not in the
                #      category_index list?
                try:
                    label = self._category_index[int(classes[0][j])]
                except KeyError:
                    continue
                else:
                    if label not in self._triggers:
                        continue
                # Check whether the object's bbox is in roi or not.
                ymin, xmin, ymax, xmax = bboxes[0][j]
                unnormalized_bbox = (xmin * width, ymin * height,
                                     xmax * width, ymax * height)
                if self._is_in_roi(unnormalized_bbox):
                    if not bool(in_roi_cands):
                        # This is the first detected object candidate
                        in_roi_cands = {"bboxes": [], "scores": [], "labels": []}
                    in_roi_cands["bboxes"].append(bboxes[0][j].tolist())
                    in_roi_cands["scores"].append(scores[0][j].tolist())
                    in_roi_cands["labels"].append(label)
            results.append(in_roi_cands)
        return results

    def _output(self, catched, motion, frames):
        ev_frames = EventVideoFrames(frames, motion, catched, self._state)
        if self._state == IntrusionDetector.STATE_NORMAL:
            self._event_video_agent.append_back_margin_queue(ev_frames)
            if any(ev_frames.triggered):
                try:
                    timestamp = ev_frames.raw[0].timestamp
                    self._current_writer = self._event_video_agent.create(
                        timestamp)
                    logging.info("Creating event video: {}".format(timestamp))
                    self._current_event = IntrusionDetectionEvent(
                        self._current_writer.video_key,
                        None,
                        self._current_writer.metadata_key,
                        ev_frames.triggered,
                        timestamp)
                except RuntimeError as e:
                    logging.error(e)
                    raise
                self._state = IntrusionDetector.STATE_ALERT_START
        elif self._state == IntrusionDetector.STATE_ALERT_START:
            self._current_writer.write(ev_frames, thumbnail=True)
            self._current_event.thumbnail = (self._current_writer.thumbnail_key)
            self._state = IntrusionDetector.STATE_ALERTING
            return self._current_event
        elif self._state == IntrusionDetector.STATE_ALERTING:
            if any(ev_frames.triggered):
                self._current_writer.reset_front_margin()
            try:
                self._current_writer.write(ev_frames)
            except EndOfMarginError:
                logging.info("End of event video")
                self._event_video_agent.clear_back_margin_queue()
                self._current_writer = None
                self._current_event = None
                self._state = IntrusionDetector.STATE_NORMAL
        else:
            assert False, "Unknown state: {}".format(self._state)

    def run(self, frames, motion):
        f_motion = self._client.scatter(motion["frames"])
        f_detect = self._client.submit(gpu_worker.run_model,
                                       "object_detection",
                                       f_motion,
                                       resources={"GPU": 1})
        catched = self._check_intrusion(f_detect.result())
        return self._output(catched, motion, frames)

    def release(self):
        if self._current_writer is not None:
            self._current_writer.end()
        self._event_video_agent.release()
