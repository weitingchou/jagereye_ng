from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import asyncio
import json
from dask.distributed import get_worker
from jagereye_ng import logging
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrConnectionClosed, ErrTimeout, ErrNoServers

CHANNEL_NAME = "notification"


class Notification(object):
    def __init__(self, nats_host):
        self._nats = NATS()
        self._io_loop = asyncio.get_event_loop()
        try:
            asyncio.run_coroutine_threadsafe(self._initialize_nats(nats_host),
                                                    self._io_loop)
        except Exception as e:
            logging.error("NATS initialization failed with exception: "
                          "{!r}".format(e))
            raise

    async def _initialize_nats(self, nats_host):
        options = {
            "servers": nats_host,
            "io_loop": self._io_loop,
            "max_reconnect_attempts": 60,
            "reconnect_time_wait": 2,
            "disconnected_cb": self._nats_disconnected_cb,
            "reconnected_cb": self._nats_reconnected_cb,
            "error_cb": self._nats_error_cb,
            "closed_cb": self._nats_closed_cb
        }
        try:
            await self._nats.connect(**options)
            logging.info("NATS connection for Notification is established.")
        except ErrNoServers as e:
            logging.error(str(e))
            raise
        except Exception as e:
            logging.error(str(e))
            raise

    async def _nats_disconnected_cb(self):
        logging.info("[NATS] disconnected")

    async def _nats_reconnected_cb(self):
        logging.info("[NATS] reconnected")

    async def _nats_error_cb(self, e):
        logging.error("[NATS] ERROR: {}".format(e))

    async def _nats_closed_cb(self):
        logging.info("[NATS] connection is closed")

    def cleanup(self):
        self._nats.close()

    def __del__(self):
        self.cleanup()

    async def push(self, category, message):
        logging.info("Pushing notification: ({}: {})".format(category, message))
        try:
            await self._nats.publish(CHANNEL_NAME, json.dumps(
                {"category": category, "message": message}).encode())
        except ErrConnectionClosed:
            logging.error("Connection closed prematurely.")
            raise
        except ErrTimeout:
            logging.error("Timeout occurred when publishing"
                          " event: {}".format(event))
            raise
        except Exception as e:
            logging.error("Failed to publish notification: {}".format(e))
            raise

def init_worker():
    worker = get_worker()
    if hasattr(worker, "name") and worker.name.startswith("PN_WORKER"):
        logging.info("Initializing worker: {}".format(worker.name))
        worker.notification = Notification(["nats://localhost:4222"])
        worker.io_loop = asyncio.get_event_loop()
    return "OK"

def push(category, message):
    worker = get_worker()
    asyncio.run_coroutine_threadsafe(
        worker.notification.push(category, message), worker.io_loop)
