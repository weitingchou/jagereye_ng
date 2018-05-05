"""Generic utilities."""

import os
import yaml

import jagereye_ng


def get_static_path(file_name):
    """Get path of a static file.

    file_name (string): The static file name.
    """
    file_dir = os.path.join(os.path.dirname(jagereye_ng.__file__), "static")
    file_path = os.path.join(file_dir, file_name)

    return file_path


def get_config(config_file="config.yml"):
    """Get the configuration.

    config_file (string): The path to the configuration file. Defaults to
      "config.yml".
    """
    with open(get_static_path(config_file), "r") as f:
        return yaml.load(f)
