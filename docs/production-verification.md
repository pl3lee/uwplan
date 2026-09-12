# Production verification

Each release must be checked against its own archived manifest. The records below
identify completed deployments; use the [production runbook](../ops/production/README.md)
for current release procedures.

## PostHog telemetry — 2026-09-12

[PR #97](https://github.com/pl3lee/uwplan/pull/97) deployed revision
`9d71633ecef9d88f59e2e6373d8d642bee001faf` through successful
[release workflow 34716516432](https://github.com/pl3lee/uwplan/actions/runs/34716516432).
All five PR checks, two code reviews, and release checks passed. The public
homepage and readiness endpoint returned HTTP 200, and both application
identities matched the published manifest:

| Artifact | Verified production digest |
| --- | --- |
| API | `sha256:2945414154bbff743615145671bac7076a2100ff2783c204dbe1eacffc34af57` |
| Web | `sha256:246473436bd75b42edb044899596d5e06452b711f1e57a65fe6d43e1c5fe386a` |

A public readiness request with validation ID
`validation-9ad26fe6-9c45-42e4-9e29-64d0fdab8015` produced a
[queryable web → API trace](https://us.posthog.com/project/606367/tracing?trace=7B7BFBCA651A946FD58A19979EDD9C5C)
and two correlated logs. The records carried `uwplan-web`/`uwplan-api`,
`deployment.environment=production`, the admitted revision, and image digests.
The final collector snapshot showed 76 accepted/sent logs, 74 accepted/sent spans,
and 12 accepted/sent metric points, with empty queues and zero refusals.

Collector memory was about 50 MiB under its 256 MiB cap, with zero restarts.
No ingestion ports were published, and application containers had no PostHog
token. Money-tracker's collector was not restarted. The shared PostHog project
remains **Default project**, ID **606367**. The Grafana uptime alert was already
removed and was not recreated. Metrics export works; the PostHog metrics viewer
is subject to private-alpha availability.

## Data preservation and recovery — 2026-09-11

The first Go/web release was verified through
[workflow 34577280447](https://github.com/pl3lee/uwplan/actions/runs/34577280447),
revision `97e09dd783005e225e0cb08338e5a876f0040fe3` from PR #89. An off-host
production archive was restored to an owned PostgreSQL 16 database. Running the
Go migrator twice preserved complete row hashes for all 55,649 rows across 15
public tables. The archive SHA-256 is
`453baa6017bfbdad4e5b00f87bab82e26fae863748f073ed7f78d81a36e12823`.
The protected backup remains outside Git.

Recovery tests verify provider links, ownership, templates, choices, selections,
and assignments. Writes through a rejected candidate survive application rollback.
A restored database supports authenticated reads, exact CSV export, creation,
and deletion after application role grants are reapplied.

Real production checks verified both OAuth callbacks, logout, and a returning
account with saved selections. Dedicated test data exercised template creation,
course selection, reload persistence, schedule creation/rename/deletion, course
assignment, and exact CSV output. The initial 30-minute production watch recorded
61 samples with zero readiness or release-identity failures.

The current browser coverage is documented in
[behavior-coverage.md](behavior-coverage.md). Live course refresh remains
unverified after upstream HTTP 403; controlled importer tests pass and the stored
catalog is preserved.
