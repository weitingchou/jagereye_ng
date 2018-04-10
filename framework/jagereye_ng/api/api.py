from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import json
from json import JSONDecodeError
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrConnectionClosed, ErrTimeout, ErrNoServers
from jagereye_ng.util import logging


class APIConnector(object):
    def __init__(self, ch_name, io_loop, nats_hosts=["nats://127.0.0.1:4222"]):
        self._ch_name = ch_name
        self._io_loop = io_loop
        self._nats_hosts = nats_hosts
        self._nats_cli = NATS()
        self._io_loop.run_until_complete(self._setup())

    async def _setup(self):
        options = {
            "servers": self._nats_hosts,
            "io_loop": self._io_loop,
            "max_reconnect_attempts": 60,
            "reconnect_time_wait": 2,
            "disconnected_cb": self._disconnected_cb,
            "reconnected_cb": self._reconnected_cb,
            "error_cb": self._error_cb,
            "closed_cb": self._closed_cb
        }
        try:
            await self._nats_cli.connect(**options)
            logging.info("NATS Connection for driver '{}' is "
                         "established.".format(self.__class__.__name__))
        except ErrNoServers as e:
            logging.error(e)
            raise
        else:
            await self._nats_cli.subscribe("api.{}".format(self._ch_name),
                                           cb=self._api_handler)

    async def _disconnected_cb(self):
        logging.info("[NATS] disconnected")

    async def _reconnected_cb(self):
        logging.info("[NATS] reconnecting to {}".format(
            self._nats_cli.connected_url.netloc))

    async def _error_cb(self, e):
        logging.error("[NATS] {}".format(e))

    async def _closed_cb(self):
        logging.info("[NATS] connection is closed")

    async def _api_handler(self, recv):
        subject = recv.subject
        reply = recv.reply
        try:
            msg = json.loads(recv.data.decode())
        except JSONDecodeError:
            raise

        response = {}
        try:
            if msg["command"] == "CREATE":
                self.on_create(msg["params"])
                response["result"] = "success"
            elif msg["command"] == "READ":
                result = self.on_read(msg["params"])
                response["result"] = result
            elif msg["command"] == "UPDATE":
                result = self.on_update(msg["params"])
                response["result"] = result
            elif msg["command"] == "DELETE":
                self.on_delete(msg["params"])
            elif msg["command"] == "START":
                self.on_start(msg["params"])
            elif msg["command"] == "STOP":
                self.on_stop(msg["params"])
        except RuntimeError as e:
            response["error"] = {"message": str(e)}
        except Exception as e:
            logging.error(e)

        try:
            await self._nats_cli.publish(reply, json.dumps(response).encode())
            # await self._nats_cli.flush(1)
        except ErrConnectionClosed as e:
            logging.error("Error ocurred when publishing response: {}, "
                          "ERROR: {}".format(response, e))
        except ErrTimeout as e:
            logging.error("Timeout ocurred when publishing response: {} "
                          "ERROR:: {}".format(response, e))

    def on_create(self, params):
        pass

    def on_read(self, params):
        pass

    def on_update(self, params):
        pass

    def on_delete(self):
        pass

    def on_start(self):
        pass

    def on_stop(self):
        pass
