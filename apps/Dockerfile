FROM jagereye/framework

MAINTAINER SuJiaKuan <feabries@gmail.com>

ENV MODEL_NAME ssd_mobilenet_v1_coco_11_06_2017

# Download TensorFlow model files.
RUN mkdir -p models/object_detection
WORKDIR models/object_detection
RUN wget http://download.tensorflow.org/models/object_detection/$MODEL_NAME.tar.gz
RUN tar zxvf $MODEL_NAME.tar.gz
RUN rm $MODEL_NAME.tar.gz
RUN find . ! -name 'frozen_inference_graph.pb' -type f -exec rm -r {} +
WORKDIR ${HOME}

# Install the dependencies.
RUN pip3 --no-cache-dir install \
        shapely==1.6.4 \
        --user

# Copy files about intrusion detection.
# TODO(JiaKuan Su): Use .pyc only.
COPY --chown=jager:jager analyzer.py .
COPY --chown=jager:jager intrusion_detection.py .
COPY --chown=jager:jager utils.py .
COPY --chown=jager:jager coco.labels .

CMD python3 analyzer.py
