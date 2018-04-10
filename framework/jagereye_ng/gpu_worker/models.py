from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import tensorflow as tf
import numpy as np
import abc


class ModelBase(object):
    def __init__(self, path=None, version=None):
        self._path = path
        self._version = version

    def load(self):
        self._graph = tf.Graph()
        with self._graph.as_default():
            od_graph_def = tf.GraphDef()
            with tf.gfile.GFile(self._path, "rb") as f:
                serialized_graph = f.read()
                od_graph_def.ParseFromString(serialized_graph)
                tf.import_graph_def(od_graph_def, name="")
            gpu_options = tf.GPUOptions(per_process_gpu_memory_fraction=0.15)
            with tf.Session(graph=self._graph, config=tf.ConfigProto(gpu_options=gpu_options)) as sess:
                self._session = sess

    def get_info(self):
        return {"version": self._version}

    @abc.abstractmethod
    def run(self):
        raise NotImplementedError()


class ObjectDetection(ModelBase):
    def __init__(self, path, version):
        super().__init__(path, version)

    def run(self, frames):
        assert self._graph, "Should load the model first before running it"
        image_tensor = self._graph.get_tensor_by_name("image_tensor:0")
        detection_boxes = self._graph.get_tensor_by_name("detection_boxes:0")
        detection_scores = self._graph.get_tensor_by_name("detection_scores:0")
        detection_classes = self._graph.get_tensor_by_name("detection_classes:0")
        num_detections = self._graph.get_tensor_by_name("num_detections:0")

        # input_data = np.stack([blob.fetch("image") for blob in frames])
        fetches = [detection_boxes,
                   detection_scores,
                   detection_classes,
                   num_detections]
        # feed_dict = {image_tensor: input_data}
        # (boxes, scores, classes, num) = \
        #    self._session.run(fetches, feed_dict=feed_dict)
        images = [np.expand_dims(frame.image, axis=0)
                  for frame in frames]
        results = [self._session.run(fetches,
                                     feed_dict={image_tensor: image})
                   for image in images]
        return results
