from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import asyncio
import json
from dask.distributed import get_worker
from jagereye_ng import logging
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, InvalidName
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrConnectionClosed, ErrTimeout, ErrNoServers

CHANNEL_NAME = "notification"


class Database(object):
    def __init__(self, db_hosts, db_name):
        self._client = MongoClient(db_hosts)
        try:
            # Check if connection is established
            self._client.admin.command("ismaster")
            self._db = self._client[db_name]
        except ConnectionFailure as e:
            logging.error("Mongo server is not available: {}".format(e))
            raise
        except InvalidName:
            logging.error("Invalid Mongo database name being used: {}"
                          .format(db_name))
            raise

    def cleanup(self):
        logging.info("Destroying Database service")
        self._client.close()

    def __del__(self):
        self.cleanup()

    def save_event(self, event):
        logging.info("Saving event: {}".format(str(event)))
        try:
            self._db["events"].insert_one(event)
        except Exception as e:
            logging.error("Failed to save event: {}, error: {}"
                          .format(event, e))


class Notification(object):
    def __init__(self, nats_hosts):
        self._nats = NATS()
        self._io_loop = asyncio.get_event_loop()
        try:
            asyncio.run_coroutine_threadsafe(self._initialize_nats(nats_hosts),
                                                    self._io_loop)
        except Exception as e:
            logging.error("NATS initialization failed with exception: "
                          "{!r}".format(e))
            raise

    async def _initialize_nats(self, nats_hosts):
        options = {
            "servers": nats_hosts,
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
        logging.info("Destroying Notification service")
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
    if hasattr(worker, "name") and worker.name.startswith("IO_WORKER"):
        logging.info("Initializing worker: {}".format(worker.name))

        # Initiralize notification service
        worker.je_notification = Notification(["nats://localhost:4222"])
        worker.je_io_loop = asyncio.get_event_loop()

        # Initialize database service
        worker.je_database = Database(["mongodb://localhost:27017"], "jager_test")
    return "OK"
