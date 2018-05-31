FROM jagereye/nodejs

MAINTAINER SuJiaKuan <feabries@gmail.com>

WORKDIR ${HOME}

# Install ffmpeg.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg net-tools sudo isc-dhcp-client iproute && \
        apt-get clean && \
        rm -rf /var/lib/apt/lists/*

COPY --chown=root:root ./settings_utils/sudoers /etc/
USER jager

# Create services structure
RUN mkdir -p jagereye_ng/services/api
RUN mkdir -p jagereye_ng/shared

# Copy service files
COPY --chown=jager:jager . ./jagereye_ng/services/api

# Copy shared files
# [NOTE] Shared files should be copied in to the build context before
#        running docker build
COPY --chown=jager:jager config.yml ./jagereye_ng/shared
COPY --chown=jager:jager messaging.json ./jagereye_ng/shared
COPY --chown=jager:jager database.json ./jagereye_ng/shared

WORKDIR jagereye_ng/services/api

RUN npm install --no-cache

ENTRYPOINT ["npm"]
CMD ["start"]
