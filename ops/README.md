# UWPlan operations

Use [the production runbook](production/README.md) for the deployed Go API and
React Router web pair, private telemetry, release admission, backups, and recovery.
[Paired release admission](production/paired-releases.md) describes the restricted
protocol and disposable rollback/restore rehearsal.

The root `compose.yaml` starts development PostgreSQL and Redis only. It has a
separate project name and volumes. Production configuration and secrets remain
under the root-owned host paths documented in the runbook.

The superseded rehearsal deployment and telemetry scripts have been removed.
Their history remains in Git. Production keeps the previous immutable legacy
artifact and `production/compose.yaml` for application rollback without reverting
database writes. New releases use `production/compose.rewrite.yaml`.
