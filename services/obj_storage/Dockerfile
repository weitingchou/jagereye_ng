FROM minio/minio:RELEASE.2018-05-11T00-29-24Z

MAINTAINER SuJiaKuan feabries@gmail.com

# Override the original entrypoint.
ENTRYPOINT []

CMD MINIO_ACCESS_KEY=${ACCESS_KEY} MINIO_SECRET_KEY=${SECRET_KEY} minio server /data
