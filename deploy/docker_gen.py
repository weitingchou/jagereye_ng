"""
docker_gen

Usage:
    docker_gen [--workdir=WORKDIR] [--rootdir=ROOTDIR] [--is_build] TARGET
    docker_gen -h | --help

Arguments:
    TARGET                  Target to generate.

Options:
    --workdir=WORKDIR       Working dirctory of the script to run in.
    --rootdir=ROOTDIR       Root dirctory of the project.
    --is_build              Specify it is a build operation. (default: false)
    -h --help               Show this screen.

Examples:
    docker_gen all
"""

from docopt import docopt
from termcolor import colored
import jinja2
import yaml
import sys
import os
import errno


SUPPORTED_TARGETS = ['all', 'services', 'apps']


def load_config(filename):
    with open(filename, 'r') as f:
        config = yaml.load(f.read())
    return config


def write_file(filename, content):
    with open(filename, 'w') as f:
        f.write(content)


def errexit(message):
    sys.exit('{}: {}'.format(colored('ERROR', 'red'), message))


class Generator(object):
    def __init__(self, workdir, rootdir):
        self._workdir = workdir if workdir else '.'
        self._rootdir = rootdir if rootdir else '.'

        # Load template
        try:
            tempfile = os.path.join(self._rootdir,
                                    'deploy/templates/docker-compose.jin')
            with open(tempfile, 'r') as f:
                tempfile = f.read()
            self._template = jinja2.Template(tempfile)
        except OSError as e:
            if e.errno == errno.ENOENT:
                errexit('Template file "docker-compose.jin" was not found')

        # Load config file
        try:
            config_file = os.path.join(self._workdir, 'shared/config.yml')
            self._config = load_config(config_file)
        except OSError as e:
            if e.errno == errno.ENOENT:
                errexit('Config file "{}" was not found'.format(e.filename))
        except KeyError as e:
            if e == 'services':
                errexit('Invalid config file format')

    def _get_service_context(self, is_build=False):
        context = self._config['services']
        # Construct build path when it's a build operation
        if is_build is True:
            for (k, v) in context.items():
                context[k]['buildpath'] = os.path.join(self._workdir,
                                                       'services', k)
        return context

    def _get_app_context(self):
        context = self._config['apps']
        return context

    def generate(self, target, is_build=False):
        environ = os.environ
        context = { "environ": environ }

        if target == 'services' or target == 'all':
            context['services'] = self._get_service_context(is_build)
        if target == 'apps' or target == 'all':
            context['apps'] = self._get_app_context()
        if is_build is True:
            context['build'] = True

        output_file = os.path.join(self._workdir, 'docker-compose.yml')
        write_file(output_file, self._template.render(context))


def main():
    options = docopt(__doc__, version='1.0.0')

    # Parse options
    workdir = options['--workdir']
    if options['--rootdir']:
        rootdir = options['--rootdir']
    elif os.environ['JAGERROOT']:
        rootdir = os.environ['JAGERROOT']
    else:
        errexit('--rootdir was not specified and JAGERROOT was not defined')
    is_build = options['--is_build'] if options['--is_build'] else False
    target = options['TARGET']

    if target not in SUPPORTED_TARGETS:
        errexit('Unsupported target: {}, should be: {}'.format(
            target, SUPPORTED_TARGETS))

    # Generate target docker-compose file
    generator = Generator(workdir, rootdir)
    generator.generate(target, is_build)


if __name__ == '__main__':
    main()
