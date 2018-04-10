from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import os
from dask.distributed import get_worker
from jagereye_ng.util import logging


class ModelPath(object):
    def __init__(self, base_dir):
        self._base_dir = base_dir

    def get(self, model_name, model_version):
        return os.path.join(
            self._base_dir,
            "models",
            model_name,
            model_version,
            "frozen_inference_graph.pb")


def init_worker(model_dir):
    worker = get_worker()
    if hasattr(worker, "name") and worker.name.startswith("GPU_WORKER"):
        logging.info("Initializing GPU worker: {}".format(worker.name))
        model_path = ModelPath(model_dir)

        from jagereye_ng import models
        worker.global_models = dict()
        worker.global_models["object_detection"] = models.ObjectDetection(
            model_path.get("object_detection",
                           "ssd_mobilenet_v1_coco_11_06_2017"),
            "ssd_mobilenet_v1_coco_11_06_2017")
        worker.global_models["object_detection"].load()
    return "OK"


def run_model(name, *args):
    return get_worker().global_models[name].run(*args)
