# Production observability

The API and web send OTLP to the existing private collector on
`ubuntu-hosting-2:4318`. Its established pipelines forward logs to Loki, traces to
Tempo, and API health metrics to Mimir. Do not install another collector or expose
an ingestion endpoint publicly.

`readiness.alloy` adds an external HTTPS readiness probe to that collector and
uses its existing `prometheus.remote_write.mimir` destination. Validate the
combined configuration before applying it. Preserve the previous configuration,
reload Alloy, and verify `probe_success`, `probe_http_status_code`, and
`probe_duration_seconds` for `https://uwplan.com/api/ready` in Mimir. Alloy supports
[configuration reloads without a service restart](https://grafana.com/docs/alloy/latest/reference/cli/run/#update-the-configuration-file).
The probe uses the documented [blackbox component](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.blackbox/)
and preserves the target URL as its `instance` label.

The existing Grafana rule UID `uwplan-rehearsal-readiness` must follow the
production probe. Update its A expression to
`probe_success{instance="https://uwplan.com/api/ready"}`, title to
`UWPlan production readiness`, and environment label to `production`. Preserve
its UID, expression/reduction pipeline, no-data/error behavior, and existing
notification route. Wait for a healthy probe sample before switching the rule.
The previously installed rule targeted the retired rehearsal URL, with no
current probe samples.

`dashboard.json` defines the `UWPlan production` dashboard, UID
`uwplan-production`. It uses the configured datasource UIDs `mimir` and `loki`.
Validate the readiness panels immediately and the API metric/log panels after
cutover. Logs use the separate `uwplan-api` and `uwplan-web` service names.

For deployment validation, send a request to `/api/ready` with a unique
`x-uwplan-validation-id: validation-UUID` header. Find both service records with
that identifier and their admitted release identities in Loki. Verify their
shared trace ID in Tempo and fresh `uwplan_health_requests_total` samples for the
API. A healthy HTTP response alone does not prove telemetry ingestion. Keep all
Grafana credentials in the configured credential store; do not include tokens,
cookies, provider callback secrets, or user data in evidence files.
