# JagerEye Framework

The directory contains framework library for developing JagerEye applications.

## Installation

You can install framework on your host machine, or build Docker images that contain the framwork.

### On the Host

* Install Python 3 (>= 3.5).

* Install Python 3 binding for OpenCV (>=2.4.0) that is compiled with [Gstreamer](https://gstreamer.freedesktop.org/).

* Install pip3.

* Run the installation script.

```bash
# The following instruction installs framework on your own home directory. You can also
# run 'sudo python3 setup.py install' to install framework on system.
python3 setup.py install --user
```

* Alternatively, you can also use `jager` command (as described in [here](https://github.com/weitingchou/jagereye_ng)) to install.

```bash
# The following instruction installs framework on your own home directory. You can also
# run 'sudo jager install' to install framework on system.
jager install --user
```

### On Docker

* Install Python 3 (>= 3.5).

* Install Docker (>=17.09.0).

* Install nvidia-docker2.

* Run the Docker building script.

```bash
python3 setup.py docker --target=worker
```

* Now, you have a new image called `jagereye/framework` that contains the framework library.
