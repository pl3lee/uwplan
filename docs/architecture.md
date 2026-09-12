# UWPlan architecture

Production runs the Go/Huma API in `api/` and React Router SSR application in
`web/`. The web serves public pages and forwards same-origin API requests; the
API owns business rules, authentication, authorization, and persistence.
PostgreSQL stores accounts and saved planning data. Redis stores opaque sessions,
and Google/GitHub provide sign-in through the existing callback URLs.

## Code and contracts

Follow [`api/AGENTS.md`](../api/AGENTS.md) for domain models, service orchestration,
repository/gateway boundaries, dependency ownership, errors, and Go tests.
Follow [`web/AGENTS.md`](../web/AGENTS.md) for SSR boundaries and browser data flow.
Huma generates the checked-in OpenAPI contract; Orval generates the TypeScript
client and TanStack Query hooks. Generate before running consumers of those files,
and commit generated output with source changes.

## Data and behavior

Preserve account IDs, provider links, ownership, saved plans, templates,
selections, schedules, URLs, and responsive flows. New domain identities use
UUIDv7. Goose owns schema migrations; its immutable baseline supports empty
setup and verified adoption of existing databases. Retain the Drizzle history
used by upgrade tests. Rollback compatibility is a release requirement.

[`behavior-coverage.md`](behavior-coverage.md) records current user-visible
contracts and regression coverage. Browser tests run the production Go/web build
with isolated PostgreSQL, Redis, and OAuth fixtures. Build and browser tests must
not run concurrently in the same checkout.

## Release and telemetry

[`ops/production/README.md`](../ops/production/README.md) is the authority for host
paths, immutable paired releases, readiness, backups, and recovery.
[`paired-releases.md`](../ops/production/paired-releases.md) documents admission
and rollback tests. Preserve the restricted deployment credential, serialized
admission, pre-migration backup, and verification of both image identities.

The private VPS collector exports `uwplan-web` and `uwplan-api` logs, traces, and
API health metrics to PostHog. Follow the
[observability runbook](../ops/production/observability/README.md) for credential
isolation, durable queues, and verification of queryable correlated records.
Release completion requires passing checks and verification of the admitted
artifacts in production; an HTTP health response alone does not prove telemetry.
