from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import asyncio
import time
from jagereye_ng import logging
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrConnectionClosed, ErrTimeout, ErrNoServers

CHANNEL_NAME = "notification"


class Notification(object):
    def __init__(self, nats_host):
        self._nats = NATS()
        self._io_loop = asyncio.get_event_loop()
        asyncio.run_coroutine_threadsafe(self._initialize_nats(nats_host),
                                         self._io_loop)

    async def _initialize_nats(self, nats_host):
        options = {
            "servers": nats_host,
            "io_loop": self._io_loop,
            "max_reconnect_attemps": 60,
            "disconnected_cb": self._nats_disconnected_cb,
            "reconnected_cb": self._nats_reconnected_cb,
            "error_cb": self._nats_error_cb,
            "closed_cb": self._nats_closed_cb
        }
        try:
            await self._nats.connect(**options)
        except ErrNoServers as e:
            logging.error(str(e))
            raise

    async def _nats_disconnected_cb(self):
        logging.info("[NATS] disconnected")

    async def _nats_reconnected_cb(self):
        logging.info("[NATS] reconnected")

    async def _nats_error_cb(self, e):
        logging.error("[NATS] ERROR: {}".format(e))

    async def _nats_closed(self):
        logging.info("[NATS] connection is closed")

    def cleanup(self):
        self._nats_client.close()
        self._io_loop.close()

    def __del__(self):
        self.cleanup()

    def push(self, category, content, timestamp=None):
        logging.info("Pushing notification: {}: {}".format(category, content))
        if timestamp is None:
            timestamp = time.time()
        msg = {
            "timestamp": timestamp,
            "category": category,
            "content": content
        }
        try:
            self._nats.publish(CHANNEL_NAME, msg)
        except ErrConnectionClosed:
            logging.error("Connection closed prematurely.")
            raise
        except ErrTimeout:
            logging.error("Timeout occurred when publishing"
                          " event: {}".format(event))
            raise
