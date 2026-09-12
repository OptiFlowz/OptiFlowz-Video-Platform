#!/bin/sh
set -eu
export PATH="/usr/lib/postgresql/17/bin:$PATH"
scratch=$(mktemp -d /tmp/pgvector-check.XXXXXX)
cleanup() {
    pg_ctl -D "$scratch/data" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$scratch"
}
trap cleanup EXIT
initdb -D "$scratch/data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$scratch/data" -l "$scratch/postgres.log" \
    -o "-k $scratch -p 55439 -c listen_addresses='' -c shared_preload_libraries='' -c shared_buffers=16MB -c max_connections=10" -w start
if ! psql -X -h "$scratch" -p 55439 -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION vector;
CREATE TABLE vector_check (embedding vector(3));
INSERT INTO vector_check VALUES ('[1,2,3]'), ('[3,2,1]');
CREATE INDEX ON vector_check USING hnsw (embedding vector_cosine_ops);
SELECT embedding, embedding <=> '[1,2,3]' AS distance FROM vector_check ORDER BY distance;
SELECT extversion FROM pg_extension WHERE extname='vector';
SQL
then
    cat "$scratch/postgres.log"
    exit 1
fi
echo 'pgvector smoke check passed'
