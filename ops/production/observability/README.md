# Production observability

## PostHog delivery

API and web send existing OTLP server logs and traces to the private
`otel-collector:4318` service in `uwplan-production` on the DigitalOcean VPS.
The Go API also sends health metrics. The collector converts Node OTLP JSON to
HTTP/protobuf and exports to `https://us.i.posthog.com/i/v1/{logs,traces,metrics}`
using a Bearer **project ingestion token** (`phc_`, never a personal `phx_` key).
Reuse US Cloud project **606367**, **Default project**; no billing or new project
is required. Filter by `service.name=uwplan-api` or `uwplan-web` and
`deployment.environment=production`. The collector adds the environment attribute
without changing existing release identities, trace IDs, or application redaction.
No product analytics, browser tracking, or session replay SDK is added.

The image is pinned to the tested 0.160.0 manifest digest. Its root filesystem is
read-only, capabilities are dropped, and it has no published ports. It uses a
256 MiB memory cap, `GOMEMLIMIT=192MiB`, a 160 MiB memory limiter, and rotated
container logs. Root is needed only for the scoped named queue volume. Each
signal persists before batching, with a 64 MiB queue and a 128 MiB database cap;
temporary upstream failures retry indefinitely. Queues are finite: a prolonged
outage or disk exhaustion can still cause loss. Export remains asynchronous, and
application SDK queues remain bounded if the collector is unavailable.

## First deployment staging

The normal CI identity admits immutable API/web digests; it cannot install host
configuration. After reviewing the PR and passing checks, copy the reviewed
`ops/production/` directory to an operator-owned staging directory on the VPS.
Run its root-only helper, supplying an existing secure env file containing the
same project's `POSTHOG_PROJECT_TOKEN`:

```sh
sudo python3 /path/to/reviewed/ops/production/stage-observability.py \
  --token-env /path/to/existing/observability.env
```

The helper validates collector configuration and Compose, acquires the existing
release lock, retains previous files under
`/var/lib/uwplan-production/observability-backup-TIMESTAMP`, and installs the
collector configuration, mode-0600 token file, paired Compose, and compatible
deployer. It does not restart applications. Keep staging and the first merge
close together: the next paired admission uses these host files. Merge only after
staging succeeds and checks pass, then follow **Release Image** through deployment.
Admission starts the collector and probes its private health endpoint with a
bounded Node check from the admitted web image before stopping either writer.

Do not copy secret values into commands, commits, screenshots, or CI output.
Never run a bare `docker compose config` against production; it prints resolved
secrets. Use `config --quiet`. The `UWPLAN_POSTHOG_ENDPOINT` override exists for
isolated rehearsals; leave it unset in production. Verify available memory and
disk capacity before adding the collector; this host also serves other apps.

## Verification

1. Run `python3 tests/test_observability.py` with Python 3 and Docker (Docker Desktop
   is supported). It uses a local fake PostHog and synthetic credentials, verifies
   all three protobuf endpoints, authentication, resource/trace identity, and
   queued delivery after SIGKILL during HTTP 503 responses. The fixture HTTP server
   listens on all host interfaces for Docker access and shuts down after the test.
   CI also runs the paired legacy/empty-database and recovery rehearsals with a
   synthetic token and a deliberately unreachable local endpoint; fixtures never
   reach production PostHog.
2. After the production release, request `https://uwplan.com/api/ready` with a
   unique `X-UWPlan-Validation-ID: validation-UUID` and sampled W3C `traceparent`.
   Check API identity and `X-UWPlan-Web-Release-*` headers against the manifest.
3. From the private web container, fetch collector health at `:13133` and diagnostic
   metrics at `:8888/metrics`. Check accepted/sent log and span counts, refused and
   failed enqueue counts, and queue size after flushing. No host port is needed.
4. Open [PostHog logs](https://us.posthog.com/project/606367/logs) and
   [tracing](https://us.posthog.com/project/606367/tracing). Find both real web/API
   request logs, the shared trace ID, the parent/child waterfall, environment and
   admitted release attributes. An HTTP 200 or exporter counter alone is not proof
   of queryable ingestion. Record the trace URL and deployment evidence.

PostHog tracing is beta. Metrics ingestion is supported but the metrics viewer is
private alpha and may require account enablement. This migration does not claim
that existing Grafana dashboards or alert rules are available in PostHog.
Official references: [logs](https://posthog.com/docs/logs/installation/go),
[traces](https://posthog.com/docs/distributed-tracing/installation/go), and
[metrics](https://posthog.com/docs/metrics).

## Rollback and retained monitoring

Application rollback uses the previous immutable web/API pair through the same
admission protocol; it retains the local collector and durable queue. Never
remove queue or database volumes during a release. To undo the telemetry host
configuration, freeze admissions under the existing deployment lock, restore
`compose.rewrite.yaml` and `uwplan-deploy` from the staging backup to their original
paths, and recreate only web/API using the retained release manifest. Their
unchanged env files contain the former home collector settings. Verify readiness
and the restored telemetry destination before unfreezing. Keep the local
collector/queue for draining and investigation; restoring a database backup is
not an observability rollback.

The retained `readiness.alloy` and `dashboard.json` are historical descriptions of
the home Grafana stack. The user has already removed the Grafana uptime alert;
the reachable Grafana instance listed no alert rules during this migration.
Do not reinstall the former `uwplan-rehearsal-readiness` rule. No change to
money-tracker's collector or the shared PostHog project is needed. Historical
Loki/Tempo/Mimir telemetry remains there; new application records go only to
PostHog after cutover. PostHog uptime monitoring is not configured by this change.
