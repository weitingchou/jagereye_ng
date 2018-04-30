from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import asyncio
from concurrent.futures import CancelledError

from jagereye_ng import logging


class AsyncTimer(object):
    def __init__(self, interval, func, *args, **kwargs):
        self._interval = interval
        self._func = func
        self._args = args
        self._kwargs = kwargs
        self._task = None

    async def _timer_job(self):
        try:
            await asyncio.sleep(self._interval)
            self._func(*self._args, **self._kwargs)
            self._task = asyncio.ensure_future(self._timer_job())
        except CancelledError:
            logging.info("AsyncTimer job has been cancelled.")
            raise

    def start(self):
        assert self._task is None, ("Perhaps you call start() twice"
                                    " by accident?")
        self._task = asyncio.ensure_future(self._timer_job())

    def cancel(self):
        if self._task is not None:
            self._task.cancel()
            self._task = None
