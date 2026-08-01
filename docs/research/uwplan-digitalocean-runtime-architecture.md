# UWPlan DigitalOcean runtime, release, and observability architecture

**Decision date:** 2026-08-01  
**Status:** Recommended architecture for the migration runbook  
**Scope:** Production UWPlan on the existing 1 GB DigitalOcean droplet. Staging remains on RackNerd/Coolify.

## Decision

Run UWPlan as a small, host-scoped Docker Compose project named `uwplan` on the existing DigitalOcean droplet:

- `app`: a minimal Next.js standalone image built in GitHub Actions from the exact `production` commit and deployed from GHCR by immutable manifest digest;
- `db`: PostgreSQL **16.14** on a Docker-managed named volume mounted at `/var/lib/postgresql/data`;
- `alloy`: the same pinned Grafana Alloy 1.16.0 image already used by the observability stack, collecting UWPlan logs, host/container metrics, and application OTLP telemetry and forwarding all three signals over Tailscale to the existing Alloy OTLP/HTTP receiver;
- `migrate`: a one-shot Compose profile using the same application release artifact, run before the app is replaced; and
- a narrow host `systemd` watchdog (not another long-running container) that restarts only the stateless app after three failed liveness checks. Database health failures alert but do not trigger an automatic database restart.

Keep Caddy as the host TLS terminator. Publish the app only on `127.0.0.1:5000`; publish no PostgreSQL or Alloy port. During rehearsal, route `v2.uwplan.com` to that loopback port behind Caddy `basic_auth`, except for a non-sensitive `/api/ready` endpoint used by the external probe. At cutover, preserve the production `AUTH_SECRET`, production OAuth credentials, and migrated database sessions, add `uwplan.com`, retain the existing `www.uwplan.com` redirect, and remove the rehearsal route after verification.

This architecture deliberately tests the 1 GB droplet, as requested, but makes capacity failure measurable. One OOM kill, one memory-limit kill, repeated low-memory pressure, sustained active swapping, or recurrent resource-caused restarts is a mandatory trigger to resize to at least 2 GB rather than tuning away safety margins.

## Evidence and constraints

### Repository

- The application is Next.js 15 with Auth.js, Drizzle, and `postgres.js`; the only required runtime secrets are the four OAuth values, `AUTH_SECRET`, and `DATABASE_URL` ([environment schema](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/src/env.js#L4-L45)).
- The current build is not configured for Next.js standalone output ([current `next.config.js`](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/next.config.js#L1-L10)). Next.js documents `output: "standalone"` as its minimal production Docker output ([Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying)).
- Database migrations exist and `npm run db:migrate` invokes Drizzle Kit, but there is no deploy-time migration contract ([package scripts](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/package.json#L6-L25)). The image therefore needs a purpose-built migration command that is available in the runtime artifact, not an implicit `db:push`.
- The database client currently uses the library defaults without explicit connection/idle limits ([database client](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/src/server/db/index.ts#L11-L18)).
- The documented release contract is automatic deployment of `production` to `uwplan.com`, while `main` continues to deploy staging ([branching strategy](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/README.md#L63-L74)). The existing checked-in CI only runs on pull requests to `main`, so the production workflow must run its own required checks before publishing and deploying ([current workflow](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/.github/workflows/pr-check.yml#L1-L58)).
- The course-refresh script makes many third-party requests without an abort timeout ([UWFlow client](https://github.com/pl3lee/uwplan/blob/cfb4a9c893c35215373215c1a10c5df6182a8611/src/lib/uwflow.ts#L41-L148)). It is an administrative script rather than a normal page request, but it must remain outside the web container's steady-state lifecycle and receive explicit timeouts before it is ever scheduled on this small host.

Node 20, which the current CI selects, reached end of life on 2026-03-24. The Node project says production applications should use an Active or Maintenance LTS release and currently lists Node 24 as LTS ([Node release schedule](https://nodejs.org/en/about/previous-releases)). The new image and CI should therefore use a pinned Node 24 LTS image, with compatibility proven in the rehearsal.

### Read-only Fleet snapshot (2026-08-01)

No host was changed during this research. No environment values or credentials were read or recorded.

| Area | Observed state | Consequence |
| --- | --- | --- |
| DigitalOcean host | 1 vCPU, 961 MiB RAM, about 370 MiB available, 373 MiB swap occupied, 12 GiB disk free; Docker 28.5.1, Compose 2.40.2, Caddy 2.10.2 | Builds must run in CI. Runtime services need hard memory limits, telemetry, and a resize gate. Existing swap occupancy alone is not proof of current pressure; active paging is the useful signal. |
| Existing DigitalOcean workloads | Nine containers; sampled container RSS totaled about 196 MiB. Existing services have no memory/CPU limits, and several unrelated ports (including database/cache ports) listen publicly. | UWPlan can be bounded and loopback-only, but noisy-neighbor risk remains because unrelated workloads are unbounded. Hardening those unrelated services is advisable but outside this migration decision. |
| Caddy | Already active; `v2.uwplan.com` already proxies to `localhost:5000` | Reuse the host Caddy service; do not add a second edge proxy container. |
| RackNerd production | Production app is commit `72e0122`; PostgreSQL reports 16.6. App RSS was about 187 MiB and production DB RSS about 49 MiB (roughly 236 MiB combined). App and DB had zero Docker restart count since the latest host boot. | The workload fits only narrowly beside current DigitalOcean services. PostgreSQL can stay on major 16 while moving to the current minor. |
| RackNerd safety controls | Both UWPlan app containers have `restart: unless-stopped`, rotated JSON logs, but no app healthcheck and no memory/CPU limit. PostgreSQL has a healthcheck. | A wedged Node process remains “Up” and is not self-healed; moving the same container configuration would carry that failure mode forward. |
| RackNerd hang evidence | The accessible kernel/Docker logs contained no OOM evidence. Persistent privileged journal history was not available to the SSH user. `wtmp` contains repeated reboot records, often near 01:30, but not the cause of the reported hangs. | The original root cause is not proven. The new design must distinguish host pressure, container health, upstream latency, and host reboot rather than assuming Coolify alone is the cause. |
| Observability host | `unraid-hosting-vps-2` runs Grafana, Alloy 1.16.0, Mimir, Loki, and Tempo. Alloy receives OTLP gRPC on loopback and OTLP/HTTP on its Tailscale address at port 4318, then routes metrics to Mimir, logs to Loki, and traces to Tempo. | One outbound OTLP/HTTP path from the droplet can use the existing stack without exposing Mimir, Loki, or Tempo individually. |

## Runtime specification

### Compose ownership and filesystem layout

Use these stable host paths:

```text
/opt/uwplan/
  compose.yaml          # reviewed, provisioned runtime definition
  release.env           # non-secret app and Alloy image digests
  alloy/config.alloy
  deploy-release        # root-owned, narrow deploy command
/etc/uwplan/
  app-v2.env            # mode 0600; rehearsal auth/database values
  app-production.env    # mode 0600; original production auth/database values
  postgres-password     # mode 0600; Compose secret source
/srv/uwplan/backups/    # mode 0700; timestamped logical dumps, seven-day retention
Docker volume: uwplan_postgres-data
Docker volume: uwplan_alloy-data
```

`release.env` contains only immutable image references and release metadata, never credentials. Compose receives application secrets from the selected root-owned env file at container creation. PostgreSQL consumes `POSTGRES_PASSWORD_FILE`; the official image explicitly supports `_FILE` for its initialization secrets ([Postgres image documentation](https://hub.docker.com/_/postgres)). Docker administrators can inspect container environment variables, so host Docker access remains privileged; the design prevents secrets from entering Git, image layers, Compose output, or CI logs, not from the host administrator.

### Services and bounds

| Service | Image and role | Initial bounds on 1 GB host | Health/restart |
| --- | --- | --- | --- |
| `app` | `ghcr.io/pl3lee/uwplan@sha256:<release-digest>`, Node 24 LTS, Next standalone, non-root user, `NODE_OPTIONS=--max-old-space-size=192` | `mem_limit: 256m`, `pids_limit: 128`, `cpus: 0.80`, `init: true`; loopback `127.0.0.1:5000:3000` only | `restart: unless-stopped`; 5-second liveness probe with 3-second timeout and 3 failures; 30-second stop grace |
| `db` | `postgres:16.14-alpine3.24@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` (manifest digest resolved 2026-08-01) | `mem_limit: 160m`, `pids_limit: 128`, `cpus: 0.50`, `shm_size: 64m`; no host port; `max_connections=20`, `shared_buffers=32MB`, bounded statement/lock/idle-in-transaction timeouts | `restart: unless-stopped`; `pg_isready`; 60-second stop grace; alert-only on unhealthy |
| `alloy` | `grafana/alloy@sha256:6e00cf7c5a692ff5f24844529416ed017d76fce922f8199004e73d5eca46b6b8` (same Alloy 1.16.0 build as central stack) | `mem_limit: 128m`, `pids_limit: 128`, `cpus: 0.25`; persistent positions/queue volume; no published port | `restart: unless-stopped`; alert if its telemetry disappears |
| `migrate` | Same app release digest, an `ops` profile, one-shot migration command | No steady-state cost; `mem_limit: 192m` | Depends on healthy DB and must exit successfully before app replacement |

These are initial guardrails, not promises that the host is large enough. Docker Compose supports service memory limits and health checks ([Compose service reference](https://docs.docker.com/reference/compose-file/services/)), and `depends_on: condition: service_healthy` prevents the app/migrator from racing database readiness ([Docker startup-order documentation](https://docs.docker.com/compose/how-tos/startup-order/)).

The app and DB share one private Compose bridge network. The DB has no published port. The app can make outbound OAuth requests but accepts inbound traffic only through Caddy's loopback listener. Apply `no-new-privileges` and drop capabilities from the app image. Retain Docker's `json-file` driver with `max-size: 10m` and `max-file: 5` so telemetry failure cannot fill disk.

For PostgreSQL 17 and earlier, the official image warns that the persistent volume must be mounted at `/var/lib/postgresql/data`, not `/var/lib/postgresql` ([official Postgres image storage note](https://hub.docker.com/_/postgres)). Stay on major 16 to match the source cluster, but restore into current minor 16.14; PostgreSQL recommends the current minor for each supported major and says 16.14 needs no dump/restore when upgrading another 16.x minor ([version policy](https://www.postgresql.org/support/versioning/), [16.14 notes](https://www.postgresql.org/docs/release/16.14/)). The migration itself should still use a logical custom-format dump plus `pg_restore`, which avoids coupling to the source container's physical volume; PostgreSQL documents dump/restore as the portable path and notes that `pg_dump` output loads into newer server versions ([`pg_dump`](https://www.postgresql.org/docs/16/app-pgdump.html)).

### Health and self-healing

Add two endpoints before rehearsal:

- `GET /api/live`: no database or third-party calls; proves the Node event loop can answer.
- `GET /api/ready`: bounded `SELECT 1`; returns only an HTTP status and generic body, never version, row counts, or connection details.

The app container healthcheck uses Node's built-in `fetch` against `/api/live`, so it does not require adding `curl` to the production image. Caddy and the external probe use `/api/ready`. A host systemd timer checks the app health state every minute; after three consecutive `unhealthy` results, it obtains the same `flock` used by deployments, restarts only `uwplan-app`, and emits a structured journald event. This is necessary because a restart policy handles process exits, while an unhealthy-but-running container can remain running—the exact gap in the RackNerd deployment.

Do not automatically restart PostgreSQL on a failed readiness probe. Alert and inspect it; repeated forced database restarts can make an underlying storage or corruption problem worse.

### Caddy routes

Caddy supports hashed-password HTTP Basic Authentication and refuses plaintext passwords in its configuration ([Caddy `basic_auth`](https://caddyserver.com/docs/caddyfile/directives/basic_auth)). Its reverse proxy supports active health probes and bounded upstream dial/response-header timeouts ([Caddy `reverse_proxy`](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)). The runbook should produce the equivalent of:

```caddyfile
v2.uwplan.com {
    @ready path /api/ready
    handle @ready {
        reverse_proxy 127.0.0.1:5000
    }
    handle {
        basic_auth {
            tester <bcrypt-hash>
        }
        reverse_proxy 127.0.0.1:5000 {
            health_uri /api/ready
            health_interval 10s
            health_timeout 3s
            health_fails 3
            transport http {
                dial_timeout 3s
                response_header_timeout 30s
            }
        }
    }
}
```

At cutover, `uwplan.com` gets the same proxy controls without `basic_auth`; `www.uwplan.com` permanently redirects to the apex, preserving current behavior. Keeping `/api/ready` public is intentional: it is non-sensitive and allows a truly external probe during the protected rehearsal. Use separate rehearsal OAuth applications/credentials, because the copied database will be replaced at final migration and rehearsal sessions are disposable. Switch to the original production `AUTH_SECRET` and production OAuth credentials before the final app starts so existing production sessions can remain valid.

## Automatic release architecture

On every push to `production`, one GitHub Actions workflow must:

1. check out the exact commit and run lint, typecheck, tests, and a Node 24 production build;
2. build only `linux/amd64` in CI (never on the droplet), using a multi-stage Dockerfile and Next standalone output;
3. publish `ghcr.io/pl3lee/uwplan` with a human-readable commit tag plus an immutable digest, generate provenance/SBOM, and retain the digest as the deployment identity;
4. join the tailnet as an ephemeral `tag:uwplan-ci` node using Tailscale's GitHub Action with workload identity federation;
5. connect over Tailscale SSH networking with a dedicated deploy key whose `authorized_keys` entry is restricted to the root-owned `deploy-release` command; and
6. invoke `deploy-release <validated-sha256-digest>`.

GitHub documents publishing to GHCR with repository `GITHUB_TOKEN`, `packages: write`, and digest-pinned official Docker actions ([GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images?learn=continuous_deployment)). Docker documents that digests are immutable while tags can be moved ([Docker image digests](https://docs.docker.com/dhi/explore/security-concepts/digests/)). The deploy must therefore consume the pushed digest, never `latest` or a mutable `production` tag.

Tailscale documents that its GitHub Action can use workload identity federation to create an ephemeral tagged node which is removed after the job, and recommends grants for new tailnet policy ([Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action), [access control](https://tailscale.com/docs/features/access-control)). The minimum grants are:

- `tag:uwplan-ci` -> DigitalOcean SSH port 22;
- DigitalOcean -> observability host TCP 4318; and
- no CI access to PostgreSQL, Docker's published ports, or the observability backends.

The deploy command must validate the digest format, acquire `/run/lock/uwplan-deploy.lock`, save the previous digest, update `release.env` atomically, pull by digest, run the one-shot migrator, recreate only the app, wait for healthy state, and automatically restore the previous image if the new app never becomes healthy. Serialize workflow runs with a production concurrency group so two pushes cannot deploy concurrently.

An image rollback does **not** roll back a database migration. Schema changes must be backward-compatible with the previous app image (expand/contract), or the release must explicitly enter a maintenance workflow with a database restore/forward-fix plan. Compose's documented single-server deployment pattern recreates the changed service without rebuilding dependencies on the host ([Compose in production](https://docs.docker.com/compose/how-tos/production/)).

## Observability architecture

### Droplet to central stack

Use a local Alloy service because it can batch/retry across a temporary Tailscale or observability-host outage and keep application export off the request path.

```text
Next.js OTLP traces/metrics ───────────────┐
Docker logs -> loki.source.docker          ├-> local Alloy batch/memory limiter
host + cAdvisor Prometheus metrics         │      -> OTLP/HTTP over Tailscale :4318
  -> otelcol.receiver.prometheus bridge ───┘            -> central Alloy
                                                         ├-> Mimir (metrics)
                                                         ├-> Loki (logs)
                                                         └-> Tempo (traces)
```

Alloy provides `prometheus.exporter.unix` for host metrics ([Grafana documentation](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.unix/)) and `prometheus.exporter.cadvisor` for container metrics, although Grafana warns that Docker collection requires privileged host access ([cAdvisor component](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.cadvisor/)). That privilege is the principal Alloy trade-off. Pin the image, mount only the documented host paths, keep its UI unexposed, filter logs to the `uwplan` Compose project, and do not give the application container Docker access.

For protocol bridging, Alloy's GA `otelcol.receiver.prometheus` converts scraped Prometheus metrics to OTLP ([metrics bridge](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.receiver.prometheus/)); `loki.source.docker` tracks positions while reading Docker logs ([Docker log source](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/)); and the GA `otelcol.receiver.loki` converts those records to OTLP logs ([logs bridge](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.receiver.loki/)). Both signals can then use `otelcol.exporter.otlphttp` to the already-listening central Alloy receiver.

Add Next.js OpenTelemetry instrumentation with `service.name=uwplan`, `deployment.environment`, and the release SHA. Next.js supports self-hosted OpenTelemetry and recommends an OpenTelemetry collector for that deployment shape ([Next.js OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry)). Start with 100% trace sampling during the one-day protected rehearsal and 10% parent-based sampling in production; increase only if the local agent and central stack stay comfortably within budget.

### External uptime and alerts

Run the public probes from `unraid-hosting-vps-2`, not from the DigitalOcean host. Alloy embeds the Prometheus blackbox exporter and can probe remote HTTPS targets without another container ([Alloy blackbox exporter](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.blackbox/)). Probe `https://v2.uwplan.com/api/ready` during rehearsal, then `https://uwplan.com/api/ready` at least every 30 seconds after cutover. This covers DNS, TLS, Caddy, Node readiness, and a database round trip from outside the droplet.

Provision Grafana alerts (only datasource provisioning exists in the inspected observability checkout, so an alert receiver must be verified or added):

- page when `probe_success == 0` for 2 minutes; warn on elevated probe latency and TLS expiry under 14 days;
- page on any OOM kill, app watchdog restart, database unhealthy state, or missing droplet telemetry for 5 minutes;
- warn when root disk exceeds 80%, container restart count increases, app/DB/Alloy uses over 85% of its limit for 10 minutes, or host memory/swap crosses the resize thresholds below; and
- annotate every deployed release digest so a regression can be correlated with a deploy.

### Mandatory resize trigger

The one-day rehearsal may proceed on 1 GB only if there is no OOM event, no health-driven restart, no sustained active swapping, no container limit pressure, and acceptable probe latency. Resize to at least 2 GB before cutover—or immediately after cutover if production traffic first exposes it—when any of these occurs:

- any kernel OOM kill or container `OOMKilled`/memory-limit exit;
- `MemAvailable < 15%` for 15 minutes twice in 24 hours;
- active swap-in or swap-out above 1 MiB/s for 5 minutes, or swap use grows by more than 256 MiB from the pre-rehearsal baseline and does not recover during an idle hour;
- app, DB, or Alloy remains over 90% of its memory limit for 15 minutes; or
- two resource-attributed app restarts in 24 hours.

Do not use the pre-existing 373 MiB of occupied swap by itself as a failure criterion: Linux can leave cold pages in swap after pressure has passed. Measure `MemAvailable`, paging rate, OOMs, latency, and limits together.

## Trade-offs and residual risk

- **One host remains one failure domain.** Compose removes Coolify complexity and adds deterministic health/telemetry, but it does not provide high availability. A DigitalOcean host outage still takes down app and DB.
- **The 1 GB experiment is tight.** Current UWPlan consumes about 236 MiB before Alloy, while the destination already shows swap occupancy and its unrelated workloads are unbounded. Limits prevent UWPlan from consuming the whole host but cannot stop a neighbor from doing so. The explicit resize gate is part of the decision, not optional follow-up.
- **Local Alloy has elevated visibility.** Container metrics/log discovery requires Docker/host access equivalent to strong host privilege. Pinning, narrow mounts, and no exposed listener reduce but do not eliminate that risk.
- **Automatic deploys increase blast radius.** Checks, immutable digests, a forced deploy command, serialized deploys, health-gated replacement, and automatic image rollback constrain that risk. Database migrations remain the exception that cannot be blindly rolled back.
- **The RackNerd root cause is unknown.** No available evidence proves Coolify, OOM, the application, or the provider caused the hangs. Health endpoint failures, watchdog events, node metrics, Docker metrics, logs, traces, blackbox probes, and release annotations are required specifically so the next incident is diagnosable.
- **Changing Node and PostgreSQL minor versions adds rehearsal work.** Staying on EOL Node 20 or PostgreSQL 16.6 is a larger security risk. Node 24 and PostgreSQL 16.14 must pass the functional rehearsal before cutover.

## Prerequisites for the implementation runbook

1. Add the multi-stage Node 24 standalone Dockerfile, `/api/live`, `/api/ready`, an explicit migration entry point, and OpenTelemetry instrumentation; validate these in CI.
2. Create the production GHCR package and the `production` push workflow, pin third-party actions by commit SHA, and create the Tailscale workload identity/tag plus least-privilege grants.
3. Provision `/opt/uwplan`, `/etc/uwplan`, `/srv/uwplan/backups`, the Compose definition, deploy command, watchdog units, root-owned secret files, and the dedicated forced-command deploy SSH key.
4. Capture pre-rehearsal host memory/swap/latency baselines; deploy local Alloy; verify metrics, logs, traces, release labels, and watchdog events arrive in Grafana.
5. Add central Alloy blackbox probes and verify a real Grafana contact point by generating and receiving a test alert.
6. Create separate rehearsal OAuth credentials and a Caddy bcrypt hash; protect every rehearsal route except `/api/ready`.
7. Resolve and record all image manifest digests at implementation time. The PostgreSQL and Alloy digests above are exact as of this decision, but normal dependency maintenance should update them through reviewed changes, never mutable tags.

With these prerequisites, the migration runbook can rehearse on `v2.uwplan.com`, apply the agreed one-day soak gate, and later repeat the logical data migration and DNS cutover without redesigning the runtime.
