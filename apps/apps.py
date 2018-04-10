from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import asyncio
from dask.distributed import LocalCluster, Client, as_completed

from analyzer import AnalyzerManager
from jagereye_ng import gpu_worker


if __name__ == "__main__":
    cluster = LocalCluster(n_workers=0)

    # Add GPU workers
    # TODO: Get the number of GPU from configuration file
    cluster.start_worker(name="GPU_WORKER-1", resources={"GPU": 1})

    with cluster, Client(cluster.scheduler_address) as client:
        # Initialize GPU workers
        results = client.run(gpu_worker.init_worker, ".")
        assert all([v == "OK" for _, v in results.items()]), "Failed to initialize GPU workers"

        # Start analyzer manager
        io_loop = asyncio.get_event_loop()
        manager = AnalyzerManager(cluster, io_loop, ["nats://localhost:4222"])
        io_loop.run_forever()
        io_loop.close()
