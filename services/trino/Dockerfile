# SpaceHarbor Trino Service
#
# Uses the official VAST Trino image with the connector pre-installed.
# No manual JAR setup needed — just set VAST_S3_ENDPOINT and credentials.
#
# The entrypoint generates vast.properties from environment variables
# and starts Trino. Zero configuration files to edit.

FROM vastdataorg/trino-vast:475

USER root
COPY entrypoint.sh /usr/local/bin/spaceharbor-entrypoint.sh
RUN chmod +x /usr/local/bin/spaceharbor-entrypoint.sh

# Ensure data directories exist and are writable by trino user
RUN mkdir -p /data/trino/var/run /data/trino/var/log && \
    chown -R trino:trino /data/trino /etc/trino

USER trino

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/spaceharbor-entrypoint.sh"]
