# DigitalOcean production

The production Compose project is `uwplan-production`, installed at
`/opt/uwplan-production`. Caddy is a host service and forwards the apex to
`127.0.0.1:5002`. The web application is the only published service; API,
PostgreSQL, and Redis remain private. PostgreSQL uses the retained database volume
and an unprivileged application login.

`/var/lib/uwplan-production/release.env` pins separate API and web Docker Hub
manifest digests and their common source revision. The paired stack uses
`/opt/uwplan-production/compose.rewrite.yaml`. Retain `compose.yaml`, the previous
immutable legacy artifact, and `app.env` until legacy rollback is retired. See
[paired release admission](paired-releases.md) for staging, configuration, failure
handling, and the disposable migration/restore rehearsal.

Main pushes must pass API generation/tests, web generation/tests, both browser
suites, and container migration/rollback checks before publication. The release
job builds AMD64 API and web images, pulls their immutable digests, and smoke-tests
those published artifacts. It archives a version-2 `release-manifest.json` with
both image references, both digests, and the shared revision. Deployment uses those
same outputs and never resolves a mutable tag.

The ephemeral Tailscale identity `tag:uwplan-ci-deployer` can reach only
`100.123.22.85:22`. A dedicated SSH key invokes `/usr/local/bin/uwplan-ci-entry`,
which delegates to the root-owned `/usr/local/sbin/uwplan-deploy`. Its restricted
command is `deploy-pair API_DIGEST WEB_DIGEST FULL_COMMIT_SHA`; the retained
`deploy DIGEST FULL_COMMIT_SHA` command supports legacy rollback. The SSH user has
no Docker group membership or unrestricted sudo.

Admission verifies both image revisions, backs up PostgreSQL, runs the compatible
migrator, replaces the pair, and verifies independent API/web readiness identities.
An unhealthy candidate restores both previous application images without reversing
schema changes or losing candidate writes. Releases are serialized by the existing
lock. Create `/var/lib/uwplan-production/frozen` to reject CI deployments during
manual maintenance; remove it only when the production stack is verified.

Auth secrets and OTLP settings remain in root-owned mode-0600 files under
`/etc/uwplan-production`, outside the repository and images. API and web export
server logs and traces with `OTEL_ENABLED=true` and
`OTEL_EXPORTER_OTLP_ENDPOINT=http://ubuntu-hosting-2.tailac98b.ts.net:4318` over the
private network. The existing collector routes logs to Loki, traces to Tempo, and
API health metrics to Mimir. Services identify themselves as `uwplan-api` and
`uwplan-web`; release identity and trace/request correlation accompany events.
Verify unique validation requests in Grafana after each cutover and check that
external readiness probes remain healthy.

Never delete Docker volumes as part of a release or rollback. Backups are retained
in `/var/lib/uwplan-production/backups`; copy them off-host and manage retention
separately. Initial migration archives are also retained on the operator Mac.
Restoring an archive requires reapplying the application role grants and verifying
application reads and writes against the restored database. The rehearsal covers
those checks with disposable data.

After the destination first accepts writes, reverting DNS to the old database
would lose data. Recovery must first stop destination writers and export its
current data into a fresh source database.
