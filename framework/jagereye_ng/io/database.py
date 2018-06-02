from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

from dask.distributed import get_client, get_worker
from jagereye_ng import logging


def _save_event(event):
    worker = get_worker()
    assert hasattr(worker, "je_database"), ("IO_WORKER have not been "
                                            "established yet.")
    worker.je_database.save_event(event)


class Database(object):
    def __init__(self):
        try:
            self._client = get_client()
        except ValueError:
            assert False, ("Should connect to Dask scheduler before"
                           " initializing this object.")

    def save_event(self, event):

        def done_callback(future):
            if future.exception() is not None:
                logging.error("Failed to save event: {}, error: {}"
                              .format(category, message, future.exception()))
                import traceback
                tb = future.traceback()
                traceback.export_tb(tb)

        future = self._client.submit(_save_event, event, resources={"IO": 1})
        future.add_done_callback(done_callback)
