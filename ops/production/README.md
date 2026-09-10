# DigitalOcean production

The production Compose project is `uwplan-production`, installed at
`/opt/uwplan-production`. Caddy is a host service and forwards the apex to
`127.0.0.1:5002`; PostgreSQL has no published ports. The application has a separate,
unprivileged database login. Auth secrets remain in root-owned mode-0600 files in
`/etc/uwplan-production`, outside the repository and image.

`/var/lib/uwplan-production/release.env` pins a Docker Hub manifest digest and
source revision. `docker compose -p uwplan-production -f
/opt/uwplan-production/compose.yaml --env-file
/var/lib/uwplan-production/release.env up -d` starts the installed stack.

Main pushes run checks and publish AMD64 images from GitHub Actions. The ephemeral
Tailscale identity `tag:uwplan-ci-deployer` can reach only `100.123.22.85:22`.
A dedicated SSH key invokes a root-owned forced-command wrapper, which accepts
only `deploy sha256:DIGEST FULL_COMMIT_SHA`. The SSH user has no Docker group
membership or unrestricted sudo. The deployer validates the image revision,
backs up PostgreSQL, runs the expand-only migrator, replaces the app and verifies
readiness. An unhealthy release restores the previous app image without
reversing database changes.

Create `/var/lib/uwplan-production/frozen` to reject CI deployments during manual
maintenance. Remove it only when the production stack is verified. Never delete
Docker volumes as part of a release or rollback. Backups are retained in
`/var/lib/uwplan-production/backups`; copy them off-host and manage retention
separately. Initial migration archives are also retained on the operator Mac.

After the destination first accepts writes, reverting DNS to the old database
would lose data. Recovery must first stop destination writers and export its
current data into a fresh source database.
