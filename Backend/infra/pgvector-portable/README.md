# Repair the pgvector CPU compatibility failure

The database machine `148e422dfe7728` in `optiflowz-pg-recovered` runs PostgreSQL
17.4 and pgvector 0.8.0. Loading the current extension caused SIGILL (illegal
instruction). This Dockerfile rebuilds the same pgvector version with
`OPTFLAGS=""`, using the exact deployed base-image digest. It retains Fly's
PostgreSQL/repmgr entrypoint and does not replace the PostgreSQL server packages.

The files have been prepared, but the image has not yet been built or deployed.
Docker Desktop was stopped when these instructions were prepared.

## Build and verify (PowerShell, from Backend)

Start Docker Desktop in Linux-container mode. Then run each command separately;
stop if any command fails. The registry tag below is new and leaves the original
image available for rollback.

```powershell
docker build --platform linux/amd64 -t registry.fly.io/optiflowz-pg-recovered:pgvector-0.8.0-portable-20260910 ./infra/pgvector-portable
docker run --rm --network none --user postgres --entrypoint /usr/local/bin/pgvector-smoke-test registry.fly.io/optiflowz-pg-recovered:pgvector-0.8.0-portable-20260910
fly auth docker
docker push registry.fly.io/optiflowz-pg-recovered:pgvector-0.8.0-portable-20260910
```

Both checks create an isolated temporary PostgreSQL cluster. They do not connect
to the real database, attach its volume, or load backend credentials.

## Snapshot and update during a maintenance window

There is one database machine, so updating its image restarts PostgreSQL and
briefly disconnects all applications using this server. Ensure a current database
backup is available, then create an additional volume snapshot:

```powershell
fly volumes snapshots create vol_v3gjz8y9e8d1j8m4 -a optiflowz-pg-recovered
fly volumes snapshots list vol_v3gjz8y9e8d1j8m4 -a optiflowz-pg-recovered
```

Wait for the snapshot to complete. Update the existing machine's image, retaining
its `/data` mount and existing configuration:

```powershell
fly machine update 148e422dfe7728 -a optiflowz-pg-recovered --image registry.fly.io/optiflowz-pg-recovered:pgvector-0.8.0-portable-20260910
fly status -a optiflowz-pg-recovered
```

Verify pgvector on the actual Fly CPU using the isolated cluster, before retrying
the application migration. This invokes no production SQL:

```powershell
fly ssh console -a optiflowz-pg-recovered --machine 148e422dfe7728 -C "runuser -u postgres -- /usr/local/bin/pgvector-smoke-test"
```

Only after the check passes and the database is healthy:

```powershell
npm run migrate -- up
```

## Image rollback

If the new image fails to start, restore the previous image using the same machine
and volume. This changes no database schema. The old image still has the original
pgvector defect, so do not use vector operations on it.

```powershell
fly machine update 148e422dfe7728 -a optiflowz-pg-recovered --image docker-hub-mirror.fly.io/aleksandaroptiflowz/pgvector-fly@sha256:52e37a27ae8f68f3ef66b60d5285bd81ea63fb93ad6bc7af9ce674c83ea26cf2
```

Do not run `fly deploy` from the backend directory to repair PostgreSQL: its
`fly.toml` targets the API app, not this database machine.

References: [pgvector portability](https://github.com/pgvector/pgvector#portability),
[Fly machine update](https://fly.io/docs/flyctl/machine-update/),
[Fly snapshots](https://fly.io/docs/volumes/snapshots/).
