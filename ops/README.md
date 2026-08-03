# UWPlan runtime stack

`compose.yaml` owns only the `uwplan` application, PostgreSQL, one-shot migrator, Alloy, and their project-scoped volumes and network. Caddy remains a host service and imports `ops/caddy/Caddyfile`.

The Compose environment must provide:

- `UWPLAN_IMAGE`: the application manifest reference (`ghcr.io/pl3lee/uwplan@sha256:…` in production);
- `RELEASE_DIGEST` and `RELEASE_REVISION`: the identity returned by readiness;
- `UWPLAN_ENV_FILE`: a mode-`0600` file containing application secrets and `DATABASE_URL`; and
- `UWPLAN_ALLOY_ENV_FILE`: a root-owned mode-`0600` observability file based on `ops/observability/alloy.env.example`;
- `POSTGRES_PASSWORD_FILE`: a mode-`0600` file containing only the `uwplan_app` password; and
- `POSTGRES_ADMIN_PASSWORD_FILE`: a separate mode-`0600` file containing only the PostgreSQL administrator password. It must not equal the app password.

Start the dependencies, run the release's one-shot migration, then admit the app:

```sh
docker compose up --detach --wait db alloy
docker compose --profile migration run --rm migrator
docker compose up --detach --wait app
```

Stopping or running `docker compose down` preserves PostgreSQL data. Deleting the named volume is intentionally not part of the lifecycle. Commands must always target this Compose file/project; no fixed container names or global cleanup are used, so neighboring workloads remain outside its scope.

## Observability tracer bullet

The application accepts a generated `x-uwplan-validation-id` only when it has the validator's restricted format. Health logs and spans carry that ID, the HTTP response echoes it, and health metrics carry the immutable `service.version` digest. The app exports OTLP traces and metrics to the Compose-local Alloy receiver. Docker sends only the app's structured stdout to Alloy's loopback-bound syslog listener. Alloy then forwards logs, metrics, and traces to the existing remote stack and records the external HTTPS readiness status and latency with blackbox metrics. The remote URLs and bearer tokens are required from `UWPLAN_ALLOY_ENV_FILE`; no fallback or repository credential exists. The host must already be joined to Tailscale, and firewall policy must limit the configured remote endpoints to the intended tailnet destination.

Grafana must have the versioned `ops/observability/grafana/rehearsal-readiness-alert.yaml` provisioning file installed with its Prometheus datasource UID and Discord webhook supplied through Grafana's protected environment. Reapplying the same UIDs is idempotent. The rule matches only the exact `v2.uwplan.com` readiness target, uses static sanitized annotations, fails closed on query/no-data errors, and sends firing and resolved messages directly to the dedicated contact point. Its rule-scoped notification timing is a five-second group wait, ten-second group interval, and four-hour repeat interval; it does not replace the existing global notification policy. The repository does not contain the webhook, create a Discord channel, or install credentials.

The deliberate failure endpoint exists only when every setting in `ops/observability/rehearsal-app.env.example` is present in the protected rehearsal app environment. It requires the exact rehearsal Host header, a strong bearer credential, and a validator-format correlation ID. The state is atomically written mode `0600`; an invalid state fails rehearsal readiness closed and an authenticated `ready` request overwrites it. The endpoint is absent by default and always unavailable on `uwplan.com` and `www.uwplan.com`, even if its environment is accidentally copied there. Do not add the rehearsal settings to the production environment.

Run the complete operational tracer bullet from one entry point:

```sh
install -o root -g root -m 0600 \
  ops/observability/validation.env.example \
  /etc/uwplan/observability-validation.env
# Replace every placeholder through the host's secret-management path.
sudo -u uwplan-operator env \
  UWPLAN_OBSERVABILITY_ENV_FILE=/etc/uwplan/observability-validation.env \
  npm run observability:validate
```

The validator refuses the production apex, requires HTTPS outside its explicit loopback-only test seam, and reads Grafana, Discord, and failure-control credentials only from the protected file. It verifies the exact provisioned rule and contact-point UIDs, sends one known readiness request, creates a release annotation, and requires real Loki rows, Prometheus samples, and Tempo trace IDs. It separately queries `probe_success`, `probe_http_status_code`, and `probe_duration_seconds` for the exact validated URL; the reported latency comes from that remote blackbox series. It then calls the rehearsal-only readiness failure controller, observes `503` plus a new Discord firing embed, restores readiness in a `finally` path, and observes a new resolved embed. Every new message is rejected if it contains any configured token/private sentinel, email/credential/user-data pattern, mention, role mention, or attachment. Stdout contains only the sanitized JSON acceptance record.

The operational timeout defaults to ten minutes and cannot be configured below four minutes. The larger default accommodates delayed cross-host telemetry ingestion before the failure drill begins; the minimum still covers the worst-case 60-second blackbox scrape, the provisioned 30-second alert evaluation, Discord delivery, and the same scrape/evaluation path after recovery with margin. Only the loopback test seam may use a shorter timeout.

`ops/observability/telemetry-vocabulary.json` is the versioned runtime-neutral contract for application, Alloy, and validator telemetry names. Run `npm run observability:check-contract` whenever instrumentation, collector labels, or queries change.

`tests/observability-validation.test.ts` is the local/CI tracer bullet. It uses fake HTTP receivers and proves orchestration, correlation queries, fail-closed configuration, recovery, and evidence redaction without contacting Grafana, Discord, Tailscale, or a deployed UWPlan instance. Passing that test is implementation evidence only. Operational acceptance still requires the real Tailscale endpoints, scoped Grafana service token and datasource UIDs, protected rehearsal failure control, a private Discord channel plus read-only bot access, and observed real firing/resolved messages.

Production Caddy reaches the backend on `127.0.0.1:5000` and uses normal automatic HTTPS when the test-only variables are unset. The disposable integration test changes the site addresses and sets the complete optional `UWPLAN_CADDY_TLS_DIRECTIVE` to `tls internal`; production leaves it empty until the separately approved origin-certificate work installs explicit TLS configuration.

The OAuth rehearsal is a separate profile, app environment, loopback port, and
Caddy site. Follow `ops/auth-rehearsal/README.md`; never attach its disposable
candidate database or dedicated provider credentials to the normal `app`
service.

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

`/etc/uwplan/runtime.env` is root-owned mode `0600` and contains only the protected `UWPLAN_ENV_FILE`, `UWPLAN_ALLOY_ENV_FILE`, `POSTGRES_PASSWORD_FILE`, and `POSTGRES_ADMIN_PASSWORD_FILE` paths. `/var/lib/uwplan-runtime/release.env` is written root-owned mode `0600`. The helper uses fixed production paths (`/opt/uwplan/current/compose.yaml`, `/etc/uwplan/runtime.env`, `/var/lib/uwplan-runtime/release.env`, and loopback readiness); environment overrides and injected Docker runners work only when the helper is executed outside its installed production path under the explicit disposable test seam.

The database bootstrap initializes `postgres` with the administrator secret
and, under that one-time superuser authority, creates or demotes `uwplan_app`
to LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, and
NOBYPASSRLS. Normal candidate restores use the separately provisioned
LOGIN+CREATEDB+NOCREATEROLE `uwplan_migration_admin` with SET-only membership
in `uwplan_app`; they neither connect as `postgres` nor alter role flags.
Candidate moves and their disposable fixture are documented in
`ops/database/README.md`.

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
