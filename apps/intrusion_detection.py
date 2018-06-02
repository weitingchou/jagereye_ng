from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import os
import datetime
from pytz import timezone
from dask.distributed import get_client
from shapely import geometry

from events import EventVideoFrame, EventVideoAgent, EventVideoPolicy

from jagereye_ng import image as im
from jagereye_ng import gpu_worker
from jagereye_ng.io.obj_storage import ObjectStorageClient
from jagereye_ng.io.notification import Notification
from jagereye_ng.io.database import Database
from jagereye_ng import logging


EVENT_ALERT_COLOR_CODE = (34, 87, 255)


def load_category_index(path):
    with open(path, "r") as f:
        lines = f.readlines()
    result = dict()
    for line in lines:
        record = line.strip().split(" ")
        result[int(record[0])] = record[1]
    return result


def transform_roi_format(roi, frame_size):
    """Transforms roi format.

    Transforms rules:
        absolution point value = relative point value * corresponding frame size

    Examples:
        Assume frame size is (100, 100),
        Expect source roi format (list of dict):
            [{"x": 0.21, "y": 0.33}, {"x": 0.32, "y": 0.43}, ...]

        Transformed roi format (list of tuple):
            [(21, 33), (32, 43), ...]

    Args:
        roi (list of objects): Input roi to be transformed.
        frame_size (tuple): The frame size of input image frames with
            format (width, height).

    Returns:
        Transformed roi.
    """
    result = []
    for r in roi:
        if ((r["x"] < 0 or r["x"] > 1) or
                (r["y"] < 0 or r["y"] > 1)):
            raise ValueError("Invalid roi point format, should be a float with "
                             "value between 0 and 1.")
        result.append((float(r["x"]) * float(frame_size[0]),
                       float(r["y"]) * float(frame_size[1])))
    return tuple(result)


class IntrusionDetector(object):
    """A class used to detect intrusion event.

    Attributes:
        roi (list of object): The region of interest with format of a list
            of tuple, such as [(21, 33), (32, 43), ...]
        triggers (list of string): The target of interest.
        frame_size (tuple): The frame size of input image frames with
            format (width, height).
        detect_threshold (float): The threshold of the detected object
            confidence value (between 0 and 1).
    """

    STATE_NORMAL = 0
    STATE_ALERT_START = 1
    STATE_ALERTING = 2
    STATE_ALERT_END = 3

    def __init__(self, roi, triggers, frame_size, detect_threshold=0.25):
        try:
            # Get Dask client
            self._client = get_client()
        except ValueError:
            assert False, ("Should connect to Dask scheduler before"
                           " initializing this object.")

        self._roi = roi
        self._roi_polygon = geometry.Polygon(self._roi)
        self.frame_size = frame_size
        self.triggers = triggers
        self.detect_threshold = detect_threshold
        self._category_index = load_category_index("./coco.labels")
        self._max_margin = 3 * 15
        self._state = IntrusionDetector.STATE_NORMAL

        logging.info("Created an IntrusionDetector (roi: {}, triggers: {}"
                     ", detect_threshold: {})".format(
                         self._roi,
                         self.triggers,
                         self.detect_threshold))

    @property
    def roi(self):
        return self._roi

    @roi.setter
    def roi(self, value):
        self._roi = value
        self._roi_polygon = geometry.Polygon(self._roi)

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
        width, height = self.frame_size

        results = []
        for i in range(len(detections)):
            (bboxes, scores, classes, num_candidates) = detections[i]

            in_roi_cands = {}
            for j in range(int(num_candidates[0])):
                # Check if score passes the threshold.
                if scores[0][j] < self.detect_threshold:
                    continue
                # Check if the object in in the trigger list.
                # XXX: Is it posssible to generate index that is not in the
                #      category_index list?
                try:
                    label = self._category_index[int(classes[0][j])]
                except KeyError:
                    continue
                else:
                    if label not in self.triggers:
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

    def _process_state(self, catched, num_frames):
        if self._state == IntrusionDetector.STATE_NORMAL:
            if catched:
                self._state = IntrusionDetector.STATE_ALERT_START
        elif self._state == IntrusionDetector.STATE_ALERT_START:
            self._margin_counter = 0
            self._state = IntrusionDetector.STATE_ALERTING
        elif self._state == IntrusionDetector.STATE_ALERTING:
            if catched:
                self._margin_counter = 0
            elif self._margin_counter > self._max_margin:
                self._state = IntrusionDetector.STATE_ALERT_END
            else:
                self._margin_counter += num_frames
        elif self._state  == IntrusionDetector.STATE_ALERT_END:
            if catched:
                self._state = IntrusionDetector.STATE_ALERT_START
            else:
                self._state = IntrusionDetector.STATE_NORMAL
        else:
            assert False, "Unknown state: {}".format(self._state)

    def run(self, frames, motions):
        f_motions = self._client.scatter(motions["frames"])
        f_detect = self._client.submit(gpu_worker.run_model,
                                       "object_detection",
                                       f_motions,
                                       resources={"GPU": 1})
        catched = self._check_intrusion(f_detect.result())

        output_frames = []
        for i in range(len(frames)):
            currnet_frame = frames[i]
            try:
                motion_idx = motions["index"].index(i)
            except ValueError:
                # No motion for the current frame, update state
                self._process_state(False, 1)
                # Set metadata with the latest state
                current_metadata = {"mode": self._state}
            else:
                current_metadata = catched[motion_idx].copy()
                # Update current state according to the corresponding catched
                # result
                self._process_state(bool(current_metadata), 1)
                # Update metadata with the latest state
                current_metadata.update({"mode": self._state})
            output_frames.append(EventVideoFrame(currnet_frame,
                                                 current_metadata))
        return output_frames

    def release(self):
        pass


class OutputPolicy(EventVideoPolicy):
    def compute(self, frame):
        if frame.metadata["mode"] == IntrusionDetector.STATE_ALERT_START:
            return EventVideoPolicy.START_RECORDING
        elif frame.metadata["mode"] == IntrusionDetector.STATE_ALERT_END:
            return EventVideoPolicy.STOP_RECORDING
        else:
            return None


class IntrusionDetectionPipeline(object):
    """A class used to run the Intrusion Detection pipeline.

    Attributes:
        anal_id (lib.ObjectID): The ObjectID of the analyzer that the pipeline
            was attached with.
        roi (list of object): The region of interest with format of a list
            of object points, such as [{"x": 0.21, "y": 0.33},
            {"x": 0.32, "y": 0.43}, ...]
        triggers (list of string): The target of interest.
        frame_size (tuple): The size of the input image frame with format
            of (width, height).
        detect_threshold (float): The threshold of the detected object
            confidence value (between 0 and 1).
        video_format (str): The output video format.
        fps (int): The output video fps.
        history_len (int): The length, in seconds, of frame history queue. This
            determines when the agent starts to record before policy returning
            action "START_RECORDING".
    """
    def __init__(self, anal_id, roi, triggers, frame_size,
                 detect_threshold=0.5, video_format="mp4", fps=15,
                 history_len=3):
        self._anal_id = anal_id
        self._obj_key_prefix = os.path.join("intrusion_detection", anal_id)
        transformed_roi = transform_roi_format(roi, frame_size)

        # Create an intruson detector
        self._detector = IntrusionDetector(
            transformed_roi,
            triggers,
            frame_size,
            detect_threshold)

        # Create output video agent
        event_video_metadata = {
            "event_name": "intrusion_detection",
            "event_custom": {"roi": transformed_roi}
        }
        self._output_agent = EventVideoAgent(
            OutputPolicy(),
            event_video_metadata,
            self._obj_key_prefix,
            frame_size,
            video_format,
            fps,
            history_len)

        # Connect to Object Store service
        self._obj_store = ObjectStorageClient()
        self._obj_store.connect()

        # Connect to Notification service
        self._notification = Notification()

        # Connect to Database service
        self._database = Database()

    def _take_snapshot(self, filename, frame):
        """Save a frame to an image file and push it to the object store.

        Args:
            filename: The name of the snapshot.
            frame: The frame object to be saved. The object should be an
                instance of VideoFrame or EventVideoFrame.

        Returns:
            The key of the snapshot in the object store.
        """
        thumbnail_key = os.path.join(self._obj_key_prefix, "{}.jpg"
                                     .format(filename))
        drawn_image = im.draw_region(frame.image,
                                     self._detector.roi,
                                     EVENT_ALERT_COLOR_CODE,
                                     0.4)
        shrunk_image = im.shrink_image(drawn_image)
        self._obj_store.save_image_obj(thumbnail_key, shrunk_image)
        return thumbnail_key

    def _output_event(self, event, thumbnail_key, triggered):
        """Output event to notification center and database.

        Args:
            event: The event object to be outputted.
            thumbnail_key: The key of the thumbnail in object store.
            triggerd: The triggerd objects of the event.
        """
        timestamp = event.content["timestamp"]
        # Create event message
        message = {
            "analyzerId": self._anal_id,
            "timestamp": timestamp,
            "type": "intrusion_detection.alert",
            "content": {
                "video": event.content["video_key"],
                "metadata": event.content["metadata_key"],
                "thumbnail": thumbnail_key,
                "triggered": triggered
            }
        }

        # Save event to database
        date_obj = (datetime.datetime
                    .utcfromtimestamp(timestamp)
                    .replace(tzinfo=timezone("UTC")))
        message.update({"date": date_obj})
        self._database.save_event(message)

        # Push notification
        mlsec = repr(timestamp).split(".")[1][:3]
        date_str = (datetime.datetime
                    .utcfromtimestamp(timestamp)
                    .replace(tzinfo=timezone("UTC"))
                    .strftime("%Y-%m-%dT%H:%M:%S.{}Z".format(mlsec)))
        message.update({"date": date_str})
        self._notification.push("Analyzer", message)

    def run(self, frames, motions):
        """Run Intrusion Detection pipeline.

        Args:
            frames: A list of raw video frames to be detected.
            motions: The motion of the input frames. It should be the output of
                video_proc.detect_motion().
        """
        detected = self._detector.run(frames, motions)

        for frame in detected:
            event = self._output_agent.process(frame)
            if event is not None:
                if event.action == EventVideoPolicy.START_RECORDING:
                    timestamp = event.content["timestamp"]
                    thumbnail_key = self._take_snapshot(timestamp, frame)
                    self._output_event(event, thumbnail_key,
                                       frame.metadata["labels"])

                elif event.action == EventVideoPolicy.STOP_RECORDING:
                    logging.info("End of event video")

    def release(self):
        self._output_agent.release()
