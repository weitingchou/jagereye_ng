from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

from dask.distributed import get_worker
from jagereye_ng import logging


def _save_event(event):
    worker = get_worker()
    assert hasattr(worker, "je_database"), ("IO_WORKER have not been "
                                            "established yet.")
    worker.je_database.save_event(event)

def save_event(event, dask_client):

    def done_callback(future):
        if future.exception() is not None:
            logging.error("Failed to save event: {}, error: {}"
                          .format(category, message, future.exception()))
            import traceback
            tb = future.traceback()
            traceback.export_tb(tb)

    future = dask_client.submit(_save_event, event, resources={"IO": 1})
    future.add_done_callback(done_callback)
