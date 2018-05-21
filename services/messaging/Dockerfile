FROM scratch

COPY gnatsd /gnatsd
COPY gnatsd.conf gnatsd.conf

# Run via the configuration file
ENTRYPOINT ["/gnatsd"]
CMD ["-c", "gnatsd.conf"]
