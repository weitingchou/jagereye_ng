FROM minio/minio:RELEASE.2018-04-04T05-20-54Z

MAINTAINER SuJiaKuan feabries@gmail.com

# Override the original entrypoint.
ENTRYPOINT []

CMD MINIO_ACCESS_KEY=${ACCESS_KEY} MINIO_SECRET_KEY=${SECRET_KEY} minio server /data
