# Preserve the exact Fly/repmgr/PostgreSQL image currently in production.
ARG BASE_IMAGE=docker.io/aleksandaroptiflowz/pgvector-fly@sha256:52e37a27ae8f68f3ef66b60d5285bd81ea63fb93ad6bc7af9ce674c83ea26cf2
FROM ${BASE_IMAGE} AS builder
USER root

# Keep the installed extension version; only change its CPU build settings.
RUN git clone --branch v0.8.0 --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector-portable \
    && cd /tmp/pgvector-portable \
    && test "$(git rev-parse HEAD)" = "2627c5ff775ae6d7aef0c430121ccf857842d2f2" \
    && make -j2 PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config OPTFLAGS="" \
    && make PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config OPTFLAGS="" DESTDIR=/opt/pgvector-portable install

FROM ${BASE_IMAGE}
COPY --from=builder /opt/pgvector-portable/ /
COPY --chmod=755 smoke-test.sh /usr/local/bin/pgvector-smoke-test

RUN sed -i 's/\r$//' /usr/local/bin/pgvector-smoke-test \
    && runuser -u postgres -- /bin/sh /usr/local/bin/pgvector-smoke-test
# Inherit the original image's entrypoint, command, user and Fly configuration.
