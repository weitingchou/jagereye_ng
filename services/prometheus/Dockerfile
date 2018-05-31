FROM prom/prometheus:v2.2.1

LABEL maintainer="blair1226@gmail.com"

COPY prometheus.yml /etc/prometheus/prometheus.yml

EXPOSE 9090
# Override the original entrypoint.
ENTRYPOINT ["prometheus"]
CMD ["--config.file=/etc/prometheus/prometheus.yml"]