# Production migration verification

## First paired cutover — 2026-09-11

Release workflow [34577280447](https://github.com/pl3lee/uwplan/actions/runs/34577280447)
passed its prerequisite suites, publication, exact-artifact smoke checks, and
restricted production admission. The deployed revision is
`97e09dd783005e225e0cb08338e5a876f0040fe3` from PR #89.

| Artifact | Published and independently observed production digest |
| --- | --- |
| API | `sha256:2d9025dcc0e6bd8ff0ee506a687b0253aaaee0ac4e23abaa934c52e052f57eac` |
| Web | `sha256:92182931b3c037e67593351f6f52656870432b083ab7ef8cacb43e9e045d21ce` |

The API readiness body and independent web release headers exactly match the
archived paired manifest. PostgreSQL and authenticated Redis report available.
The previous immutable legacy release remains available at
`docker.io/pl3lee/uwplan@sha256:1eb83a3e80ae89ca38c488d7a6f5a975583463b15dfb2b6728841c48e1a37daf`,
revision `b0618e0a2f79f913d1fb8ee1b205ee843751641e`.

## Data and recovery

An off-host copy of the actual pre-cutover production archive was restored to an
owned PostgreSQL 16 database. Running the Go migrator twice preserved complete
row hashes for all 55,649 rows across 15 public tables. The archive SHA-256 is
`453baa6017bfbdad4e5b00f87bab82e26fae863748f073ed7f78d81a36e12823`.
The protected backup is outside Git; no account records or credentials belong in
evidence files.

The production-shaped paired rehearsal additionally verifies provider links,
ownership, templates, free choices, selected courses, and assignments. It writes
through a rejected candidate, restores both prior services, verifies that the
retained legacy artifact can read those writes, and restores a backup into a
fresh database. Authenticated reads, exact CSV export, creation, and deletion
work after restoring the application role grants. The cleanup reran this test
using the exact retained production image rather than rebuilding legacy source.

## Browser checks

All 33 shared behavior cases pass against production Go/web builds in CI, using
real PostgreSQL/Redis and controlled Google/GitHub provider transports. No behavior
assertions were removed during the runtime cleanup.

Real production checks verified both Google and GitHub callbacks, logout, and a
returning GitHub account with saved selections. A dedicated Google test account
created a temporary template containing CS135, attached it, selected the course,
and verified the immediate UI and reload persistence. A temporary schedule was
created, reloaded, assigned the course, renamed, and deleted. Its downloaded CSV
exactly matched CS135 and the persisted Fall 2027 assignment. Deleting the owned
test template removed its membership and selection; the default schedule remained.
No unrelated user's data was edited.

## Grafana ingestion

Validation request `validation-237796a0-41ec-4d9e-9db4-728917af4888` appears for
both `uwplan-api` and `uwplan-web` in Loki, with the admitted release digests.
The collector stores attributes as structured metadata:

```logql
{service_name=~"uwplan-api|uwplan-web"} | validation_id="validation-237796a0-41ec-4d9e-9db4-728917af4888"
```

Tempo trace `167d266f4c708c0a03f282b3cfde6f00` contains the web request span and
its API child, both carrying that validation ID and the correct service versions.
Mimir returns fresh `uwplan_health_requests_total{job="uwplan-api"}` samples and
`probe_success{instance="https://uwplan.com/api/ready"} = 1`.
The `UWPlan production` dashboard uses UID `uwplan-production`.

A production memory sample measured API 32.8 MiB/128 MiB, web 77.3 MiB/128 MiB,
Redis 2.4 MiB/64 MiB, and PostgreSQL 34.7 MiB/160 MiB. All four containers were
healthy with zero restarts and no OOM kills. This is an observed sample, not a
capacity benchmark.

## Remaining verification

The initial 30-minute production watch is in progress. Two error-severity web
records correlated to unmatched requests returning 404; a focused regression
check separates expected HTTP rejection from actual rendering/server failures.
The observed application responses did not return 5xx during that sample window.

The existing readiness alert is file-provisioned. Its production URL/title/label
update is prepared, preserving its UID and notification route, and awaits
approval for reloading it through a brief shared Grafana restart. API updates
cannot change a file-provisioned rule's provenance.

The runtime cleanup and expected-404 telemetry fix must pass review/CI, merge,
and deploy before declaring the migration complete. Live course refresh remains
unverified because the upstream returns HTTP 403; controlled import tests pass
and the stored catalog is preserved.
