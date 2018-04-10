"""Logging utilities."""

from __future__ import absolute_import
from __future__ import division
from __future__ import print_function

import logging as _logging
from logging import DEBUG # pylint: disable=unused-import
from logging import ERROR # pylint: disable=unused-import
from logging import FATAL # pylint: disable=unused-import
from logging import INFO # pylint: disable=unused-import
from logging import WARN # pylint: disable=unused-import


_logging.basicConfig(level=_logging.DEBUG)
_logger = _logging.getLogger('jagereye_ng')


def log(level, msg, *args, **kwargs):
    """Log message for a given level.

    Args:
      level (int): The log level.
      msg (string): The message to log.
    """
    _logger.log(level, msg, *args, **kwargs)


def debug(msg, *args, **kwargs):
    """Log debug level message.

    Args:
      msg (string): The message to log.
    """
    _logger.debug(msg, *args, **kwargs)


def error(msg, *args, **kwargs):
    """Log error level message.

    Args:
      msg (string): The message to log.
    """
    _logger.error(msg, *args, **kwargs)


def fatal(msg, *args, **kwargs):
    """Log fatal level message.

    Args:
      msg (string): The message to log.
    """
    _logger.fatal(msg, *args, **kwargs)


def info(msg, *args, **kwargs):
    """Log info level message.

    Args:
      msg (string): The message to log.
    """
    _logger.info(msg, *args, **kwargs)


def warn(msg, *args, **kwargs):
    """Log warn level message.

    Args:
      msg (string): The message to log.
    """
    _logger.warn(msg, *args, **kwargs)


def warning(msg, *args, **kwargs):
    """Log warn level message.

    Args:
      msg (string): The message to log.
    """
    _logger.warning(msg, *args, **kwargs)


# Controls which methods from pyglib.logging are available within the project.
_allowed_symbols_ = [
    'DEBUG',
    'ERROR',
    'FATAL',
    'INFO',
    'WARN'
    'debug',
    'error',
    'fatal',
    'info',
    'log',
    'warn',
    'warning'
]
