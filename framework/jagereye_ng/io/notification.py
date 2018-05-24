from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import asyncio
from dask.distributed import get_client, get_worker
from jagereye_ng import logging


def _push(category, message):
    worker = get_worker()
    assert hasattr(worker, "je_notification"), ("IO_WORKER have not been "
                                                "established yet.")
    asyncio.run_coroutine_threadsafe(
        worker.je_notification.push(category, message), worker.je_io_loop)


class Notification(object):
    def __init__(self):
        try:
            self._client = get_client()
        except ValueError:
            assert False, ("Should connect to Dask scheduler before"
                           " initializing this object.")

    def push(self, category, message):

        def done_callback(future):
            if future.exception() is not None:
                logging.error("Failed to push notification: ({}, {}), error: {}"
                              .format(category, message, future.exception()))
                import traceback
                tb = future.traceback()
                traceback.export_tb(tb)

        future = self._client.submit(_push, category, message,
                                     resources={"IO": 1})
        future.add_done_callback(done_callback)

