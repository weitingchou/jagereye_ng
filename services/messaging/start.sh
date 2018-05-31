#!/usr/local/bin/bash

# start the prometheus exporter
/prometheus-nats-exporter -varz "http://localhost:7777" &

# Run via the configuration file
/gnatsd -c gnatsd.conf
