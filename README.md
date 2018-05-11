# JagerEye

JagerEye is a large distributed scale video analysis framework.

## Installation

### Prerequisites

The following packages are required before installation
- docker>=17.09.0
- nvidia-docker2
- docker-compose
- python>=3.5
- pip3

### Steps

* Clone the project and go to the directory.
```bash
git clone https://github.com/weitingchou/jagereye_ng
cd jagereye_ng
```

* Export environment variables.
```bash
# The root directory of the project.
export JAGERROOT=$(pwd)
# The mode to build JagerEye, it can be 'development' or 'production'/
export JAGERENV=development
# Path to the binary folder.
export PATH=$JAGERROOT/bin:$PATH
```

* Install the dependencies for building services.
```bash
pip3 install -r deploy/requirements.txt
```

* Build the base docker images for services.
```bash
jager build servicebase
```

* Build the base docker images for applications.
```bash
jager build appbase
```

* Build the docker images for services and applications.
```bash
# You can also build services and applications separately by running
# 'jager build services' and 'jager build apps'.
jager build all
```

* Now, we can start running applications and services.
```bash
# You can also start services and applications separately by running
# 'jager start services' and 'jager start apps'.
jager start all
```

## Contributing

### Coding Style Guildline

#### Pytohn

* Follow [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html).

* To learn how to write docstrings, [Example Google Style Python Docstrings](http://sphinxcontrib-napoleon.readthedocs.io/en/latest/example_google.html) is a good example.

#### Node.js

```bash
TODO
```
