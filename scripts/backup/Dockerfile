# The backup service image.
#
# Two tools are needed and no single official image has both: `pg_dump`/`psql`
# for the database and `mc` for the S3-compatible object store. Copying the
# static `mc` binary out of its own release image keeps the build reproducible —
# the alternative, curl-ing a binary at container start, is a network dependency
# in the one service that has to work when things are going wrong.
FROM minio/mc:RELEASE.2025-08-13T08-35-41Z AS mc

# Same major version as the `postgres` service in docker-compose.yml. pg_dump
# refuses to dump a server newer than itself, so these two move together.
FROM postgres:18

# `openssl` for the optional at-rest encryption of a recovery set. Everything
# else (pg_dump, psql, gzip, tar, find, sha256sum) is already in the base image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=mc /usr/bin/mc /usr/local/bin/mc

COPY backup.sh restore.sh healthcheck.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
  /usr/local/bin/healthcheck.sh /usr/local/bin/entrypoint.sh

# `mc` writes its alias config here; the container runs as root inside its own
# namespace, but pinning the path keeps it off any mounted volume.
ENV MC_CONFIG_DIR=/tmp/mc

VOLUME ["/backups"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
