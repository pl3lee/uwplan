# UWPlan runtime stack

`compose.yaml` owns only the `uwplan` application, PostgreSQL, one-shot migrator, Alloy, and their project-scoped volumes and network. Caddy remains a host service and imports `ops/caddy/Caddyfile`.

The Compose environment must provide:

- `UWPLAN_IMAGE`: the application manifest reference (`ghcr.io/pl3lee/uwplan@sha256:…` in production);
- `RELEASE_DIGEST` and `RELEASE_REVISION`: the identity returned by readiness;
- `UWPLAN_ENV_FILE`: a mode-`0600` file containing application secrets and `DATABASE_URL`; and
- `POSTGRES_PASSWORD_FILE`: a mode-`0600` file containing only the database password.

Start the dependencies, run the release's one-shot migration, then admit the app:

```sh
docker compose up --detach --wait db alloy
docker compose --profile migration run --rm migrator
docker compose up --detach --wait app
```

Stopping or running `docker compose down` preserves PostgreSQL data. Deleting the named volume is intentionally not part of the lifecycle. Commands must always target this Compose file/project; no fixed container names or global cleanup are used, so neighboring workloads remain outside its scope.

Production Caddy reaches the backend on `127.0.0.1:5000` and uses normal automatic HTTPS when the test-only variables are unset. The disposable integration test changes the site addresses and sets the complete optional `UWPLAN_CADDY_TLS_DIRECTIVE` to `tls internal`; production leaves it empty until the separately approved origin-certificate work installs explicit TLS configuration.

## Restricted production releases

A push to `production` checks the source, builds and publishes one image, and then passes only the returned `sha256:` manifest digest and source revision to the DigitalOcean host. The runner joins Tailscale as the ephemeral `tag:uwplan-ci-deployer` identity. Tailnet policy should allow that tag to reach only the deployment host's SSH port. The repository's `production` environment provides the OAuth credentials, pinned SSH host key, restricted private key, and `UWPLAN_DEPLOY_HOST` variable.

The corresponding public key belongs to the unprivileged `uwplan-deploy` host account. Its `authorized_keys` entry must force the repository-owned dispatcher and prohibit every optional SSH capability:

```text
restrict,command="/opt/uwplan/current/ops/deploy/forced-command.mjs" ssh-ed25519 REPLACE_WITH_DEPLOY_PUBLIC_KEY uwplan-production
```

The account executes the dispatcher as `uwplan-deploy` and owns only `/var/lib/uwplan-deploy` (`0700`) and its state/evidence (`0600`). It must not belong to `docker`, read the Docker socket, receive password login, or receive a general-purpose sudo rule. The dispatcher accepts exactly `deploy <sha256-digest> <revision>`, `freeze`, or `thaw`; it never evaluates shell syntax. Its only privilege boundary is noninteractive sudo to the fixed, root-owned Compose helper.

Prepare that boundary from a separately authenticated root session; do not run these installation commands from CI:

```sh
install -d -o root -g root -m 0755 /usr/local/libexec/uwplan-deploy
install -o root -g root -m 0755 ops/deploy/compose-adapter.mjs /usr/local/libexec/uwplan-deploy/compose-adapter.mjs
install -o root -g root -m 0644 ops/deploy/protocol.mjs /usr/local/libexec/uwplan-deploy/protocol.mjs
install -o root -g root -m 0440 ops/deploy/uwplan-deploy.sudoers /etc/sudoers.d/uwplan-deploy
install -d -o root -g root -m 0700 /var/lib/uwplan-runtime /etc/uwplan
install -d -o uwplan-deploy -g uwplan-deploy -m 0700 /var/lib/uwplan-deploy
chown -R root:root /opt/uwplan/current
chmod 0755 /opt/uwplan/current/ops/deploy/forced-command.mjs
chmod 0644 /opt/uwplan/current/ops/deploy/protocol.mjs
visudo -cf /etc/sudoers.d/uwplan-deploy
```

`/etc/uwplan/runtime.env` is root-owned mode `0600` and contains only the protected `UWPLAN_ENV_FILE` and `POSTGRES_PASSWORD_FILE` paths. `/var/lib/uwplan-runtime/release.env` is written root-owned mode `0600`. The helper uses fixed production paths (`/opt/uwplan/current/compose.yaml`, `/etc/uwplan/runtime.env`, `/var/lib/uwplan-runtime/release.env`, and loopback readiness); environment overrides and injected Docker runners work only when the helper is executed outside its installed production path under the explicit disposable test seam.

Validate the installation before enabling the key:

```sh
test "$(stat -c '%U:%G %a' /usr/local/libexec/uwplan-deploy/compose-adapter.mjs)" = "root:root 755"
test "$(stat -c '%U:%G %a' /usr/local/libexec/uwplan-deploy/protocol.mjs)" = "root:root 644"
test "$(stat -c '%U:%G %a' /etc/sudoers.d/uwplan-deploy)" = "root:root 440"
test "$(stat -c '%U:%G %a' /var/lib/uwplan-deploy)" = "uwplan-deploy:uwplan-deploy 700"
! id -nG uwplan-deploy | tr ' ' '\n' | grep -Fx docker
! sudo -u uwplan-deploy test -r /var/run/docker.sock
sudo -u uwplan-deploy sudo -n -l | grep -F /usr/local/libexec/uwplan-deploy/compose-adapter.mjs
visudo -cf /etc/sudoers.d/uwplan-deploy
```

The dispatcher serializes operations with an exclusive lock and records mode-`0600` state plus JSONL evidence. The release migrator first validates every embedded SQL file against `migration-compatibility.json`: the historical hashes are immutable, and every new migration must satisfy the deliberately narrow expand-only grammar. Anything else fails closed for separate review; this check is a supported-contract gate, not a claim to understand arbitrary SQL. Only after that gate does migration run, followed by recreation of `app` alone and admission of the exact digest through `/api/ready`. Failed candidate readiness attempts the previous image without reversing schema. If that image also fails readiness, state records the running release as unknown rather than claiming rollback succeeded. `freeze` and `thaw` are idempotent deployment controls, and `thaw` never releases an image.
