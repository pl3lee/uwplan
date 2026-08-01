# PROTOTYPE — UWPlan production migration runbook

> **Do not execute this prototype against production.** It is a review artifact, not an implemented automation package. Every `uwplan-*` command below is a required command shape that must be implemented, peer-reviewed, installed, and exercised during rehearsal before this runbook can be approved for execution.

## Purpose and authority

This runbook moves `uwplan.com` production from RackNerd/Coolify to a host-scoped Docker Compose project on the DigitalOcean droplet, preserves acknowledged writes and existing production sessions, and keeps a tested reverse-migration path for seven days.

- Sole migration, go/no-go, and rollback authority: **Pak Lam (Billy) Lee (`pl3lee`)**.
- Execution window: 60 minutes from the write fence to public reopening.
- Automatic pre-write abort deadline: minute 45 if every pre-open gate has not passed.
- Staging remains on RackNerd/Coolify and is never touched by this runbook.
- A post-write rollback always reverse-migrates current DigitalOcean data into a fresh RackNerd database. The stale pre-cutover database is never restarted.

## Decision sources

- [Choose the DigitalOcean runtime, release, and observability architecture](https://github.com/pl3lee/uwplan/issues/39)
- [Choose the rehearsal and cutover authentication model](https://github.com/pl3lee/uwplan/issues/40)
- [Choose the production-data migration and recovery protocol](https://github.com/pl3lee/uwplan/issues/41)
- [Set the rehearsal acceptance gate and 1 GB resize triggers](https://github.com/pl3lee/uwplan/issues/42)
- [Approve the DNS cutover and rollback decision tree](https://github.com/pl3lee/uwplan/issues/43)

## Canonical boundaries

**Write fence:** maintenance is public, deployments are frozen, the RackNerd production app is stopped, three database-session checks across 60 seconds show no application session, and the operator records the timestamp and source WAL position. Any later RackNerd app session or write invalidates the final archive.

**DigitalOcean write epoch:** the operator records the timestamp immediately before admitting the first authenticated browser to the final DigitalOcean candidate. RackNerd becomes stale at this instant. Any later rollback requires reverse migration.

**RackNerd rollback write epoch:** after a post-write reverse restore, the operator records a new timestamp immediately before private write validation against the fresh RackNerd candidate.

## Secret-safe operating rules

1. Keep shell tracing disabled. Never run this runbook from a shell configured with `set -x`.
2. Do not put passwords, database URLs, OAuth secrets, Auth.js secrets, Basic Auth values, Cloudflare tokens, session cookies, or bypass tokens in command arguments, Git, issues, evidence output, or shell history.
3. Secret-consuming commands read from a root-owned mode-`0600` file descriptor or an interactive no-echo prompt.
4. Evidence contains identifiers, versions, timestamps, counts, hashes, and pass/fail results—never row values, cookies, tokens, or raw environment files.
5. Every migration run uses a UTC identifier and mode-`0700` evidence directory under `/srv/uwplan-migration/runs/` on both VPSes. Files use mode `0600` and `umask 077`.
6. Transfer archives only over SSH. Never use public object storage, Git, an issue attachment, or an HTTP upload.

Safe operator initialization:

```sh
set -o errexit -o nounset -o pipefail
set +x
umask 077

export UWPLAN_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
export UWPLAN_DO_IP="174.138.114.254"
export UWPLAN_EVIDENCE_DIR="/srv/uwplan-migration/runs/${UWPLAN_RUN_ID}"
```

Do not export secret values.

## Required implementation package

This gate currently fails on the repository's `main` branch. The following artifacts must exist before rehearsal:

- Node 24 standalone production Dockerfile and immutable GHCR image build.
- `/api/live` and dependency-aware, non-sensitive `/api/ready` endpoints.
- Next.js OpenTelemetry instrumentation for metrics, logs, and traces.
- Host-scoped Compose project `uwplan` containing `app`, PostgreSQL 16.14, pinned Alloy, and an explicit one-shot migration profile.
- Named PostgreSQL data volume mounted at `/var/lib/postgresql/data`.
- App, database, and Alloy memory limits of 256 MiB, 160 MiB, and 128 MiB respectively for the initial 1 GB rehearsal.
- Caddy configuration for loopback-only app traffic at `127.0.0.1:5000`, protected rehearsal, production host, `www` redirect, and Cloudflare Origin CA.
- Host systemd watchdog that restarts only the stateless app after three failed liveness checks; database health failures alert but never auto-restart PostgreSQL.
- Tailscale grants and ephemeral CI identity for the forced deployment command.
- GitHub Actions production workflow that checks, builds, publishes by digest, invokes the forced command, migrates, health-checks, and rolls back only the app image.
- Backward-compatible database migration policy; image rollback must never assume schema rollback.
- Alloy collection and Grafana dashboards/alerts for every accepted telemetry gate.
- Private Discord alert destination with a verified firing and resolved notification.
- Rehearsal-only Google and GitHub OAuth applications and credentials.
- Cloudflare Origin CA certificate, fail-closed maintenance Worker, operator-bypass Worker secret, narrowly scoped DNS token, and captured apex/`www` record metadata.
- The command suite below, installed with immutable checksums and supporting `--dry-run` where meaningful.

## Required command suite

These names are the interface contract for implementation. A command must exit nonzero on an unmet gate and write a sanitized JSON and Markdown result to the active evidence directory.

| Command shape                                                                    | Host         | Required behavior                                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uwplan-preflight --run-id ID`                                                   | operator     | Verify identities, versions, digests, disk, permissions, connectivity, credentials by capability, and every required artifact without printing secrets. |
| `uwplan-deploy-freeze on\|off --target old\|new`                                 | operator     | Disable/enable the named deploy path idempotently and prove its state. `off` must not trigger a release.                                                |
| `uwplan-maintenance on\|off\|status --run-id ID`                                 | operator     | Manage the fail-closed Worker route and verify normal/OAuth/readiness behavior from two networks.                                                       |
| `uwplan-maintenance bypass issue\|revoke --ttl 30m`                              | operator     | Issue/revoke the one-time operator cookie without logging its secret.                                                                                   |
| `uwplan-source sessions --samples 3 --interval 30s`                              | RackNerd     | Report only counts and application names from `pg_stat_activity`; exclude the operator validation session.                                              |
| `uwplan-source fence --run-id ID`                                                | RackNerd     | Stop only production app, prove Coolify cannot recreate it, record fence timestamp and WAL position, then prove zero application sessions.              |
| `uwplan-source stop-db --run-id ID`                                              | RackNerd     | Stop the exact production PostgreSQL container after the final archive is verified; leave staging untouched.                                            |
| `uwplan-db capture --purpose rehearsal\|cutover\|rollback --run-id ID`           | source       | Use the pinned PostgreSQL 16 client, exported snapshot, complete custom archive, and privacy-safe manifest.                                             |
| `uwplan-db transfer --to digital-ocean\|racknerd --run-id ID`                    | source       | Transfer over SSH into the exact protected directory and verify SHA-256 on both ends.                                                                   |
| `uwplan-db restore --candidate NAME --run-id ID`                                 | target       | Create fresh DB from `template0`, restore atomically with `uwplan_app`, run `ANALYZE`, and leave failures offline.                                      |
| `uwplan-db validate --source-manifest FILE --candidate NAME --run-id ID`         | target       | Enforce every version, schema, ledger, count, content, sequence, constraint, index, owner, and role gate.                                               |
| `uwplan-app candidate start\|stop --environment rehearsal\|production\|rollback` | target       | Attach only the named validated DB and exact secret reference; record digest and DB identity.                                                           |
| `uwplan-app validate --mode read-only\|private-write\|public`                    | target       | Run the approved health, session, OAuth, workflow, HTTPS, redirect, log, metric, and trace gates for that mode.                                         |
| `uwplan-dns switch-to-digitalocean\|switch-to-racknerd\|status`                  | operator     | Patch only captured apex/`www` origin values, preserve proxy status, verify response and live readiness, and never print the token.                     |
| `uwplan-evidence sign GO\|NO-GO\|WRITE-FENCE\|DO-WRITE-EPOCH\|RN-WRITE-EPOCH`    | operator     | Append a UTC, immutable operator decision to the sanitized evidence record.                                                                             |
| `uwplan-backup daily --run-id ID`                                                | DigitalOcean | Produce and copy a verified logical backup during retention.                                                                                            |
| `uwplan-retention check --run-id ID`                                             | both         | Prove stale containers are stopped, archives protected, backup/test-restore requirements met, and no incident resets the clock.                         |

## Phase A — implementation and preflight

### A1. Verify the implementation package

```sh
uwplan-preflight --run-id "$UWPLAN_RUN_ID"
```

Expected evidence:

- exact app, PostgreSQL, Alloy, utility-client, and configuration digests;
- host identities, UTC clock status, Tailscale reachability, and SSH forced-command identity;
- Caddy configuration validation and Origin CA hostname/expiry validation;
- captured Cloudflare record IDs, old origin values, types, and proxied state;
- deployment freeze/thaw and DNS switch dry runs;
- root-owned secret/evidence paths with expected modes;
- enough disk and inodes for two archives plus candidates;
- test alert and recovery delivered to the private Discord channel.

**STOP:** any missing artifact, placeholder command, mutable image tag, expired/untrusted certificate, broad Cloudflare token, secret in output, failed dry run, or missing evidence.

### A2. Verify current production facts without treating old observations as constants

Resolve the current RackNerd production app and database from Coolify labels and the application's actual database host. Verify PostgreSQL major/patch, relation inventory, migration ledger, extension list, locales, database size, image digest, and current source role attributes. Never print its connection URL.

Verify DigitalOcean capacity, neighboring workloads, current swap activity, Caddy listener ownership, port `5000` availability, and Tailscale/Alloy reachability.

### A3. Rehearsal identity and access

- `v2.uwplan.com` uses a disposable database, rehearsal-only `AUTH_SECRET`, dedicated Google/GitHub clients, and `AUTH_TRUST_HOST=true`; `AUTH_URL` remains unset.
- Caddy Basic Auth covers every path, including OAuth callbacks, except non-sensitive `/api/ready`.
- Caddy strips the Basic `Authorization` header before proxying.
- Rehearsal data is visibly labelled disposable and is never promoted.

## Phase B — rehearsal restore and recovery drill

### B1. Capture a live consistent rehearsal copy

```sh
ssh racknerd-vps -- uwplan-db capture \
  --purpose rehearsal --run-id "$UWPLAN_RUN_ID"
ssh racknerd-vps -- uwplan-db transfer \
  --to digital-ocean --run-id "$UWPLAN_RUN_ID"
```

The capture must use one exported `REPEATABLE READ` snapshot for archive and manifest. The complete archive is equivalent to:

```sh
pg_dump --format=custom \
  --no-owner --no-privileges \
  --file="DUMP.tmp" \
  --username=postgres --dbname=uwplan
```

The implementation atomically renames `DUMP.tmp` only after a zero exit, retains stderr, rejects unexplained warnings, runs `pg_restore --list`, and records SHA-256. It must not use `--no-sync`, filters, cluster globals, or source superuser credentials on the target.

### B2. Restore a fresh rehearsal candidate

```sh
ssh digital-ocean -- uwplan-db restore \
  --candidate "uwplan_rehearsal_${UWPLAN_RUN_ID}" --run-id "$UWPLAN_RUN_ID"
ssh digital-ocean -- uwplan-db validate \
  --source-manifest "SOURCE_MANIFEST" \
  --candidate "uwplan_rehearsal_${UWPLAN_RUN_ID}" --run-id "$UWPLAN_RUN_ID"
```

Required restore shape:

```sh
pg_restore --username=postgres --role=uwplan_app \
  --dbname="CANDIDATE_DB" \
  --no-owner --no-privileges \
  --single-transaction --exit-on-error --verbose \
  "DUMP_FILE"
```

`uwplan_app` must be LOGIN but not superuser, database creator, role creator, replication-enabled, or RLS-bypassing. It owns every application object; the app cannot connect as `postgres`.

### B3. Mandatory exact-match gates

All are pass/fail:

1. `pg_dump` exits zero without unexplained warning; `pg_restore --list` recognizes a complete archive.
2. Source and target archive SHA-256 match.
3. Atomic restore exits zero.
4. Source/target/tooling remain PostgreSQL major 16; target/tooling meet the rehearsed patch requirement and exact image digest.
5. Encoding, locale provider, collation, character classification, extensions, and non-default tablespaces match.
6. Normalized schema hashes match.
7. Drizzle ledger hash/count/max id match the current repository and source.
8. Every ordinary table row count and privacy-safe canonical content hash match.
9. Every sequence definition, value, and `is_called` match.
10. Target has zero unvalidated constraints and invalid indexes, matching source.
11. Database/object ownership and `uwplan_app` role attributes pass.
12. `ANALYZE` succeeds and app read-only health passes.
13. Both VPSes retain identical archives in mode-`0700` parents/mode-`0600` files without row values or secrets in evidence.

### B4. Reverse-restore drill

After approved tester writes, stop the rehearsal app and repeat the same protocol from DigitalOcean into a **fresh, non-serving** RackNerd candidate. Validate every gate and start the preserved app only against that candidate in an isolated route. Never overwrite or attach to the live RackNerd database.

**STOP:** any failed forward or reverse gate blocks the soak.

## Phase C — protected 24-hour acceptance soak

Start the exact rehearsed image, configuration, role, and candidate at `v2.uwplan.com`. Record the soak start only after every prerequisite passes.

Restart the full 24-hour clock after any application image, database/schema, Compose/Caddy runtime, auth/secret, resource-limit, host-size, or hard-gate fix. Documentation, dashboard presentation, and routing-only alert fixes do not reset it when they do not change the monitored system.

### C1. Required functional matrix

- Latest stable desktop Chrome at 1440×900 or larger.
- Safari on a physical iPhone at representative mobile width.
- Fresh Google and GitHub sign-ins in both environments using distinct-email test identities.
- Repeated sign-in returns to the same user without duplicate account, plan, or schedule rows.
- Same-email cross-provider attempt fails safely without merge or duplicate.
- Desktop: choose plan; add/remove fixed/free courses; create/rename schedule; change term range; drag courses; export CSV.
- Mobile: select courses and assign/move/remove them with mobile controls.
- Reload and sign out/in; intended state persists.
- Create/rename/delete disposable custom plan and secondary schedule.
- No unexpected browser, application-log, or trace errors.

### C2. Availability, latency, and load

- Probe `/api/ready` every 60 seconds.
- At least 99.9% success excluding one marked deployment/restart test; no two consecutive failures and no unexplained DNS/TLS/timeout/5xx.
- Planned restart restores readiness within two minutes.
- Readiness p95 at most 500 ms; no successful readiness response above two seconds.
- Core pages/actions p95 at most two seconds; no request above five seconds; no hung or duplicate submission.
- Run one 30-minute workload at twice the previous seven-day peak five-minute request rate. Without trustworthy history, use ten concurrent read-heavy users and at most one controlled write per second. Never automate OAuth login.

### C3. Resource gates

- Any OOM, memory-limit kill, or resource restart: resize to at least 2 GB and repeat the full soak.
- Any other unexplained app/PostgreSQL/Alloy restart: block and diagnose.
- `MemAvailable < 15%` for five minutes or three periods: resize.
- Swap input/output above 1 MiB/s for five minutes or three periods: resize.
- Any UWPlan service above 90% of limit for five minutes: resize/retune and repeat.
- Host CPU above 90% for five minutes: investigate; resize/repeat when resource-caused.
- Disk/inodes at 80%, or less than 5 GiB free: block until corrected.
- No restart counter may increase unnoticed.

### C4. Observability and recovery evidence

Grafana must show external, host, container, application, PostgreSQL, and release signals agreed in the acceptance decision. Alerts cover readiness, OOM/restarts, resources, 5xx, and failed deployment health. A firing and resolved alert must reach Discord.

Attach the forward/reverse restore reports, browser/OAuth matrix, probes/percentiles, Grafana snapshots, resource summaries, alert delivery, anomalies, exact digests/config revisions, and soak times to one sanitized acceptance package.

```sh
uwplan-evidence sign GO
```

Only `pl3lee` may sign. Anything other than a complete explicit GO ends this attempt.

## Phase D — cutover preflight and maintenance

Open the announced 60-minute window only while every accepted rehearsal artifact remains unchanged.

```sh
uwplan-preflight --run-id "$UWPLAN_RUN_ID"
uwplan-deploy-freeze on --target old
uwplan-deploy-freeze on --target new
uwplan-maintenance on --run-id "$UWPLAN_RUN_ID"
uwplan-maintenance status --run-id "$UWPLAN_RUN_ID"
```

Require no-store maintenance `503` on normal and OAuth paths from two networks. Only `/api/ready` passes. If either deploy path is live or any user path reaches an origin, **STOP** before touching RackNerd.

## Phase E — establish the write fence

```sh
ssh racknerd-vps -- uwplan-source fence --run-id "$UWPLAN_RUN_ID"
uwplan-evidence sign WRITE-FENCE
```

Evidence must include exact production app identity, stopped state, disabled Coolify recreation path, three zero-session samples over 60 seconds, UTC fence timestamp, and source WAL position.

Any app restart, application session, or write after this point invalidates the archive and restarts Phase E.

## Phase F — final archive and fresh DigitalOcean candidate

```sh
ssh racknerd-vps -- uwplan-db capture \
  --purpose cutover --run-id "$UWPLAN_RUN_ID"
ssh racknerd-vps -- uwplan-db transfer \
  --to digital-ocean --run-id "$UWPLAN_RUN_ID"
ssh digital-ocean -- uwplan-db restore \
  --candidate "uwplan_cutover_${UWPLAN_RUN_ID}" --run-id "$UWPLAN_RUN_ID"
ssh digital-ocean -- uwplan-db validate \
  --source-manifest "SOURCE_MANIFEST" \
  --candidate "uwplan_cutover_${UWPLAN_RUN_ID}" --run-id "$UWPLAN_RUN_ID"
ssh racknerd-vps -- uwplan-source stop-db --run-id "$UWPLAN_RUN_ID"
```

Do not reuse the rehearsal archive/database. Do not run seeds or repository migrations against restored data. A failed candidate remains offline with sanitized diagnostics; any retry uses a new run id and candidate name.

## Phase G — read-only production candidate

1. Stop the rehearsal app and detach `v2.uwplan.com` before loading production credentials.
2. Load the exact existing production `AUTH_SECRET` and Google/GitHub credentials through the production secret reference. Keep `AUTH_TRUST_HOST=true`; leave `AUTH_URL` unset.
3. Attach the approved release only to the fresh final candidate.

```sh
ssh digital-ocean -- uwplan-app candidate start --environment production
ssh digital-ocean -- uwplan-app validate --mode read-only
```

Require the expected digest, candidate identity, liveness/readiness, migration ledger, representative migrated records, clean logs/metrics/traces, and no authenticated request.

## Phase H — switch proxied Cloudflare origins

```sh
uwplan-dns switch-to-digitalocean
uwplan-dns status
```

Patch only the captured apex and `www` origin values to `174.138.114.254`; preserve their types, proxy state, and unrelated fields. Keep maintenance active. Require Full (strict) origin TLS and the expected DigitalOcean readiness through Cloudflare from multiple networks for five continuous minutes.

Cloudflare record propagation need not be atomic: RackNerd is stopped and all user/OAuth paths remain at edge maintenance.

## Phase I — declare the DigitalOcean write epoch and validate privately

Complete every read-only check first.

```sh
uwplan-maintenance bypass issue --ttl 30m
uwplan-evidence sign DO-WRITE-EPOCH
ssh digital-ocean -- uwplan-app validate --mode private-write
```

The bypass uses a one-time bootstrap URL and host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie. The Worker strips it before origin forwarding. Record the epoch immediately before opening the existing-session browser.

Private gate:

1. Existing production browser session survives and shows expected saved data.
2. Fresh Google and GitHub sign-ins succeed.
3. Representative migrated users/plans/schedules/sessions and digest are correct.
4. Disposable schedule create/rename/delete and course move persist after reload.
5. CSV export is valid.
6. Live/ready, PostgreSQL, probes, HTTPS, `www` redirect, logs, metrics, and traces pass.
7. Ten clean minutes show no 5xx, restart, resource breach, integrity discrepancy, or alert.

Any failure now enters the post-write policy. Never restart the stale RackNerd database.

## Phase J — reopen and monitor

```sh
uwplan-maintenance bypass revoke
uwplan-maintenance off --run-id "$UWPLAN_RUN_ID"
ssh digital-ocean -- uwplan-app validate --mode public
```

Verify public app and OAuth from two networks. Allow up to five minutes for stale maintenance responses, then require one clean hour with deployments still frozen.

```sh
uwplan-deploy-freeze off --target new
```

This must not trigger a release. Leave old Coolify production deployment disabled permanently. Keep the tested maintenance Worker ready for emergency reuse.

## Decision tree — pre-write abort

Enter this path for any immediate pre-write stop condition or when minute 45 arrives before every pre-open gate passes.

```sh
uwplan-maintenance on --run-id "$UWPLAN_RUN_ID"
uwplan-dns switch-to-racknerd   # only if origins had changed
ssh racknerd-vps -- uwplan-app candidate start --environment production
ssh racknerd-vps -- uwplan-app validate --mode private-write
uwplan-maintenance off --run-id "$UWPLAN_RUN_ID"
```

Restart the unchanged original RackNerd PostgreSQL before its app when it had been stopped. Discard only the precisely named failed DigitalOcean candidate after retaining sanitized evidence. Restore old deployment behavior only after one clean hour.

This path is legal only when no authenticated request was admitted to DigitalOcean. If the DigitalOcean write epoch was recorded, use reverse migration.

## Decision tree — post-write incident

Immediately restore maintenance for data-integrity concern, suspected incorrect/lost write, database failure, critical security exposure, repeated crash/OOM, both-provider auth failure, or five-minute readiness loss.

A fix-forward is legal only when the issue is a known reversible configuration error with no data effect and can be corrected and fully revalidated within 15 minutes. Do not improvise a code release. At 15 minutes—or immediately for data risk—reverse-migrate.

## Decision tree — reverse migration to RackNerd

```sh
uwplan-maintenance on --run-id "$UWPLAN_RUN_ID"
uwplan-deploy-freeze on --target new
ssh digital-ocean -- uwplan-app candidate stop --environment production
ssh digital-ocean -- uwplan-source sessions --samples 3 --interval 30s
ssh digital-ocean -- uwplan-db capture \
  --purpose rollback --run-id "$UWPLAN_RUN_ID"
ssh digital-ocean -- uwplan-db transfer \
  --to racknerd --run-id "$UWPLAN_RUN_ID"
ssh racknerd-vps -- uwplan-db restore \
  --candidate "uwplan_rollback_${UWPLAN_RUN_ID}" --run-id "$UWPLAN_RUN_ID"
ssh racknerd-vps -- uwplan-db validate \
  --source-manifest "SOURCE_MANIFEST" \
  --candidate "uwplan_rollback_${UWPLAN_RUN_ID}" --run-id "$UWPLAN_RUN_ID"
ssh racknerd-vps -- uwplan-app candidate start --environment rollback
uwplan-dns switch-to-racknerd
```

Require the expected new RackNerd candidate through Cloudflare for five clean minutes. Then:

```sh
uwplan-maintenance bypass issue --ttl 30m
uwplan-evidence sign RN-WRITE-EPOCH
ssh racknerd-vps -- uwplan-app validate --mode private-write
uwplan-maintenance bypass revoke
uwplan-maintenance off --run-id "$UWPLAN_RUN_ID"
```

Monitor for one hour before restoring the old deployment path. Keep DigitalOcean stopped and retain both data/evidence sets.

If DigitalOcean is unreadable enough that no reverse archive can be made, **STOP** and display the timestamp of the latest verified backup. Recovery can meet only that backup's RPO; zero acknowledged-write loss is no longer possible. `pl3lee` must explicitly acknowledge the measured recovery point before restore.

## Seven-day rollback retention

After successful DigitalOcean reopening:

1. Keep old RackNerd production app and PostgreSQL stopped.
2. Disable its Coolify auto-deploy and public Traefik routes.
3. Preserve volumes, exact image, environment reference, and original database unchanged and labelled `stale—do not start`.
4. Keep mode-restricted final archives on both VPSes.
5. Produce a verified DigitalOcean logical backup immediately and daily; copy each to RackNerd.
6. Run a post-cutover test restore of at least one backup.
7. Verify daily that stale containers remain stopped and evidence remains protected.
8. Complete one controlled normal deployment through the DigitalOcean production pipeline.

```sh
uwplan-backup daily --run-id "$UWPLAN_RUN_ID"
uwplan-retention check --run-id "$UWPLAN_RUN_ID"
```

The seven-day clock resets after a material migration incident or runtime change. Eligibility for a separate decommissioning task requires seven continuous stable days, seven verified backups, one test restore, one controlled deployment, no unresolved incident, clean monitoring, a final backup/evidence package, and explicit `pl3lee` approval.

Decommissioning removes only stopped RackNerd production resources. Staging and Coolify remain.

## Final evidence index

The sanitized evidence package must link or contain:

- exact application, Compose/config, PostgreSQL, Alloy, and tooling digests;
- operator identity and UTC timestamps for GO, write fence, DigitalOcean write epoch, any RackNerd rollback epoch, reopening, and retention completion;
- source/target identities, candidate names, WAL position, archive names/sizes/SHA-256, and file modes;
- every database manifest and exact-match result;
- browser/device/OAuth/workflow matrix;
- availability, latency, load, resource, restart, HTTPS, telemetry, and alert results;
- Cloudflare record before/after metadata and origin/TLS verification;
- deployment freeze/thaw evidence;
- every anomaly, stop, retry, abort, or rollback disposition;
- daily backup and test-restore results;
- final GO/NO-GO and decommission eligibility decision.

No secret, raw row value, cookie, token, credential, database URL, or dump content belongs in this index.
