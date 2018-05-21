FROM tensorflow/tensorflow:1.7.1-gpu-py3

MAINTAINER SuJiaKuan <feabries@gmail.com>

ENV NUMPY_VERSION 1.14.3
ENV OPENCV_VERSION 3.3.1
ENV CUDNN_MAJOR_VERSION 7
ENV CUDNN_FULL_VERSION 7.0.5.15-1+cuda9.0

WORKDIR /root

# Install system packages.
RUN apt-get update && apt-get install -y --no-install-recommends --allow-downgrades \
        build-essential \
        cmake \
        libcudnn${CUDNN_MAJOR_VERSION}=${CUDNN_FULL_VERSION} \
        gstreamer1.0-libav \
        gstreamer1.0-plugins-bad \
        gstreamer1.0-plugins-base \
        gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-ugly \
        libavcodec-dev \
        libavformat-dev \
        libgstreamer1.0-0 \
        libgstreamer1.0-dev \
        libgstreamer-plugins-base1.0-dev \
        libswscale-dev \
        pkg-config \
        python3-dev \
        unzip \
        wget \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Get pip.
RUN curl -O https://bootstrap.pypa.io/get-pip.py && \
    python3 get-pip.py && \
    rm get-pip.py

RUN pip3 --no-cache-dir install \
        numpy==${NUMPY_VERSION}

# Install OpenCV.
# TODO(JiaKuan Su):
# 1. Remove unnecessary dependencies.
# 2. Check what dependencies should be added for acceleration.
RUN wget https://github.com/opencv/opencv/archive/${OPENCV_VERSION}.zip
RUN unzip ${OPENCV_VERSION}.zip
WORKDIR opencv-$OPENCV_VERSION/build
RUN cmake \
        -D BUILD_DOCS=OFF \
        -D BUILD_EXAMPLES=OFF \
        -D BUILD_PERF_TESTS=OFF \
        -D BUILD_TESTS=OFF \
        -D BUILD_PYTHON_SUPPORT=ON \
        -D CMAKE_BUILD_TYPE=RELEASE \
        -D CMAKE_INSTALL_PREFIX=$(python3 -c "import sys; print(sys.prefix)") \
        -D CV_TRACE=OFF \
        -D INSTALL_C_EXAMPLES=OFF \
        -D WITH_FFMPEG=OFF \
        -D PYTHON_EXECUTABLE=$(which python3) \
        -D PYTHON_INCLUDE_DIR=$(python3 -c "from distutils.sysconfig import get_python_inc; print(get_python_inc())") \
        -D PYTHON_PACKAGES_PATH=$(python3 -c "from distutils.sysconfig import get_python_lib; print(get_python_lib())") \
        ..
RUN make install -j$(nproc)
WORKDIR /root
RUN rm -r \
        ${OPENCV_VERSION}.zip \
        opencv-${OPENCV_VERSION}

# Install JagerEye framework library.
# TODO(JiaKuan Su): Use .pyc only.
WORKDIR framework
COPY setup.py .
COPY setup.cfg .
COPY MANIFEST.in .
COPY requirements.txt .
COPY jagereye_ng jagereye_ng
RUN python3 setup.py install
WORKDIR /root
RUN rm -r framework

# Add a user: "jager" and switch to it.
RUN groupadd -g 999 jager && \
    useradd -r -m -u 999 -g jager jager
USER jager
ENV HOME /home/jager
WORKDIR ${HOME}
