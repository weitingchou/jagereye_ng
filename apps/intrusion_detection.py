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

from jagereye_ng import video_proc as vp
from jagereye_ng import image
from jagereye_ng import gpu_worker
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
                metadata.append({"boxes": [], "scores": [], "labels": [], "mode": mode})
            else:
                matched.update({"mode": mode})
                metadata.append(matched)
        return metadata

class EventVideoWriter(object):
    def __init__(self,
                 filename,
                 rel_out_dir,
                 abs_out_dir,
                 video_format,
                 roi,
                 fps,
                 size,
                 back_margin,
                 max_margin):
        self._max_margin = max_margin
        self._writer = VideoStreamWriter()

        self.rel_video_filename = os.path.join(rel_out_dir, "{}.{}".format(filename, video_format))
        self.rel_metadata_filename = os.path.join(rel_out_dir, "{}.json".format(filename))
        self.rel_thumbnail_filename = os.path.join(rel_out_dir, "{}.jpg".format(filename))

        self.abs_video_filename = os.path.join(abs_out_dir, "{}.{}".format(filename, video_format))
        self.abs_metadata_filename = os.path.join(abs_out_dir, "{}.json".format(filename))
        self.abs_thumbnail_filename = os.path.join(abs_out_dir, "{}.jpg".format(filename))

        try:
            self._writer.open(self.abs_video_filename, fps, size)
        except RuntimeError:
            raise

        self._front_margin_counter = 0
        self._metadata = {"frames": [], "fps": fps, "custom": {"region": roi}}

        # Flush out back margin queue
        for i in range(len(back_margin)):
            ev_frames = back_margin.popleft()
            if i == 0:
                self._metadata["start"] = float(ev_frames.raw[0].timestamp)
            self._writer.write(ev_frames.raw)
            self._metadata["frames"].extend(ev_frames.metadata)

    def reset_front_margin(self):
        self._front_margin_counter = 0

    def write(self, ev_frames, thumbnail=False):
        self._writer.write(ev_frames.raw)
        self._metadata["frames"].extend(ev_frames.metadata)
        if thumbnail:
            image.save_image(self.abs_thumbnail_filename, ev_frames.raw[0].image)
        self._front_margin_counter += ev_frames.length
        if self._front_margin_counter >= self._max_margin:
            self._metadata["end"] = float(ev_frames.raw[-1].timestamp)
            self.end()
            raise EndOfMarginError()

    def end(self):
        self._writer.end()
        # Write out video metadata file
        with open(self.abs_metadata_filename, "w") as f:
            json.dump(self._metadata, f)
            logging.info("Saved metadata file {}".format(
                self.abs_metadata_filename))


class EventVideoAgent(object):
    def __init__(self,
                 rel_out_dir,
                 abs_out_dir,
                 frame_size,
                 roi,
                 video_format,
                 fps,
                 margin):
        self._rel_out_dir = rel_out_dir
        self._abs_out_dir = abs_out_dir
        self._frame_size = frame_size
        self._roi = list(roi) if isinstance(roi, tuple) else roi
        self._video_format = video_format
        self._fps = fps

        self._max_margin_in_frames = self._fps * margin
        self._back_margin_q = deque(maxlen=self._max_margin_in_frames)

        # Create event folder if not exists
        if not os.path.exists(self._abs_out_dir):
            os.makedirs(self._abs_out_dir)

    def create(self, filename):
        if not isinstance(filename, str):
            filename = str(filename)
        try:
            # Create video writer
            writer = EventVideoWriter(
                filename,
                self._rel_out_dir,
                self._abs_out_dir,
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

        # TODO: Should construct the options from configuration file.
        rel_out_dir = os.path.join("intrusion_detection", anal_id)
        abs_out_dir = os.path.expanduser(os.path.join(
            "~/jagereye_shared", rel_out_dir))
        ev_options = {
            "rel_out_dir": rel_out_dir,
            "abs_out_dir": abs_out_dir,
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
                        # TODO: Should figure out whether to use "boxes" or
                        #       "bboxes"?
                        in_roi_cands = {"boxes": [], "scores": [], "labels": []}
                    in_roi_cands["boxes"].append(bboxes[0][j].tolist())
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
                        self._current_writer.rel_video_filename,
                        None,
                        self._current_writer.rel_metadata_filename,
                        ev_frames.triggered,
                        timestamp)
                except RuntimeError as e:
                    logging.error(e)
                    raise
                self._state = IntrusionDetector.STATE_ALERT_START
        elif self._state == IntrusionDetector.STATE_ALERT_START:
            self._current_writer.write(ev_frames, thumbnail=True)
            self._current_event.thumbnail = (self._current_writer
                                             .rel_thumbnail_filename)
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

        """
        drawn_images = []
        if any(catched):
            drawn_images = [vp.draw_region(
                frame,
                self._roi,
                (66, 194, 244))
                for frame in frames]
        else:
            drawn_images = [vp.draw_region(
                frame,
                self._roi,
                (226, 137, 59))
                for frame in frames]
        for drawn_image in drawn_images:
            cv2.imshow("frame", drawn_image)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
        """

        return self._output(catched, motion, frames)

    def release(self):
        if self._current_writer is not None:
            self._current_writer.end()
        self._event_video_agent.release()
