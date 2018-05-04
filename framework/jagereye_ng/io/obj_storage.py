"""Object Storage manipulation."""

import json
import os
from io import BytesIO

import boto3
import cv2
from botocore.client import ClientError

from jagereye_ng.util.generic import get_config


class ObjectStorageClient(object):
    """Client of object storage."""

    def __init__(self):
        """Create a new `ObjectStorageClient`"""
        self._client = None
        self._bucket_name = None

    def connect(self):
        """Connect to the object storage."""
        # Get configuration for object storage.
        config = get_config()["services"]["obj_storage"]
        endpoint_url = config["params"]["endpoint_url"]
        bucket_name = config["params"]["bucket_name"]
        access_key = config["credentials"]["access_key"]
        secret_key = config["credentials"]["secret_key"]

        # Connect to the object store.
        self._client = boto3.client("s3",
                                    endpoint_url=endpoint_url,
                                    aws_access_key_id=access_key,
                                    aws_secret_access_key=secret_key)

        # Create a new bucket if the target bucket does not exist.
        try:
            self._client.head_bucket(Bucket=bucket_name)
        except ClientError:
            policy = self._gen_public_read_policy(bucket_name)
            self._client.create_bucket(Bucket=bucket_name)
            self._client.put_bucket_policy(Bucket=bucket_name, Policy=policy)

        self._bucket_name = bucket_name

    def save_obj(self, key, obj):
        """Save an object to object store.

        Args:
          key (string): The key of the object.
          obj (bytes|bytearray|file-like object): The object to be saved.
        """
        if not self._client:
            raise RuntimeError("Not connected to object storage yet")

        # Save the object to the bucket.
        self._client.put_object(Bucket=self._bucket_name, Key=key, Body=obj)

    def save_image_obj(self, key, image):
        """Save an image to object store.

        Args:
          key (string): The key of the image.
          image (numpy `ndarray`): The image to be saved.
        """
        # Get the file file extension
        _, file_extension = os.path.splitext(key)
        # Convert image to an object that can be saved in object store.
        obj = cv2.imencode(file_extension, image)[1].tostring()
        # Save the image object.
        self.save_obj(key, obj)

    def save_json_obj(self, key, json_val):
        """Save a json to object store.

        Args:
          key (string): The key of the json.
          json_val (json-like object): The json to be saved. The type is json-like,
            including dict, list, tuple, string, int, float, int- & float-derived
            Enums, True, False and None.
        """
        # Convert the json value to bytes.
        json_bytes = json.dumps(json_val, ensure_ascii=False).encode("utf-8")

        # Store the json bytes in memory and then save to object store.
        with BytesIO(json_bytes) as obj:
            self.save_obj(key, obj)

    def save_file_obj(self, key, file_path):
        """Save a file from file system to object store.

        Args:
          key (string): The key of the file.
          file_path (string): The path to the file.
        """
        # Open the file and then save it to object store.
        with open(file_path, "rb") as obj:
            self.save_obj(key, obj)

    def _gen_public_read_policy(self, bucket_name):
        """Generate a bucket policy to be public readable.

        Args:
          bucket_name (string): The bucket name for the policy.
        """
        policy = {
            "Version": "2012-10-17",
            "Statement": [{
                "Sid": "",
                "Effect": "Allow",
                "Principal": {
                    "AWS": ["*"]
                },
                "Action": ["s3:GetObject"],
                "Resource": ["arn:aws:s3:::{}/*".format(bucket_name)]
            }]
        }

        return json.dumps(policy)
