FROM mongo:3.6.0

MAINTAINER uniray7 uniray7@gmail.com

# TODO: need add access control setting

COPY mongodb_exporter-linux-amd64 /mongodb_exporter
COPY start.sh /start.sh

RUN chmod +x /mongodb_exporter && chmod +x /start.sh

EXPOSE 27017 9001

CMD ["/start.sh"]
