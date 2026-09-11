# UWPlan rewrite plan

Status: implementation and production verification complete; runtime cleanup is merged.
The first paired release passed its 30-minute production watch; see
`docs/migration-verification.md` for evidence, the activated production alert,
and the external course-source limitation. Verify each later deployment against its own manifest.
All 33 shared browser cases pass on the replacement production build and remain required in CI.

Inspected baseline: `origin/main` at `982cee8bbff6ed21d55c7fa43a8d2e23db909dfe`.
Fetch again before implementation and base the first branch on the latest
`origin/main`. Preserve unrelated local work. Rebase subsequent work on the latest
merged main and rerun affected checks.

## Outcome and scope

Replace Next.js with a Go API and React Router web application in one repository.
Preserve existing user-facing features, URLs, account identities, ownership,
saved plans, templates, selections, schedules, term ranges, and course data.
Keep the current visual design and responsive behavior as the parity baseline.
Port course-import/update tooling and CSV export behavior too.

Use UWPlan names throughout code, documentation, module paths, package metadata,
telemetry, images, examples, and PR text. Do not include references to the
repository used to inspect the desired conventions.

## Target stack and conventions

| Area | Target |
| --- | --- |
| Repository | `api/`, `web/`, shared `e2e/`, existing operational tooling; pnpm workspace and Make targets |
| API | Go, Chi, Huma; generated, checked-in OpenAPI JSON and YAML |
| Persistence | Existing PostgreSQL database; pgx, sqlc, Goose |
| Sessions | Redis-backed opaque sessions; Google and GitHub OAuth |
| Web | React 19, React Router 7 framework mode with SSR, TypeScript, Vite, Tailwind 4 |
| Client | Orval-generated fetch client and TanStack Query hooks; checked-in output |
| UI tooling | TanStack Form/Table where applicable, shadcn/Base UI conventions, Biome, Vitest |
| Go testing | mockery v3, go-cmp, pgtestdb, Make targets, tagged integration tests |
| Browser testing | Playwright against real application services and isolated test data |
| Telemetry | OpenTelemetry logs, traces, and metrics to the configured collector; Grafana verification |

Pin compatible tool versions and commit lockfiles. Keep PostgreSQL on its current
production major version during this rewrite; a database version upgrade is a
separate change.

Carry the user's architecture preferences into UWPlan's root guidance and
`api/AGENTS.md`, adapted to UWPlan paths and commands:

1. Put domain objects and behavior in `internal/domain/<domain>/models.go`, with
   sentinel errors in `errors.go`. Define domain objects independently of database
   rows and HTTP DTOs. Preserve existing IDs; generate UUIDv7 for new entities.
2. Put orchestration in `internal/service/`, persistence in
   `internal/repository/`, and external integrations in `internal/gateway/`.
   Pass domain objects across these boundaries and return standard Go errors.
3. Define dependency interfaces in the consuming package's `interface.go`;
   implementations live in `impl.go`, with concrete constructors and consistent
   `SomethingServiceImpl`, `SomethingRepositoryImpl`, and `SomethingGatewayImpl`
   names. Services own repository/gateway ports; API packages own any service
   ports needed for testing. Generate package-local `mock.go` files.
4. Translate storage types inside repositories, map meaningful infrastructure
   errors to domain errors, preserve identity with `%w`, and translate errors to
   HTTP only in handlers. Use snake_case JSON and generic, client-safe 500 bodies.
5. Prefer table-driven tests and `cmp.Diff`, including complete decoded HTTP
   response bodies. Use generated dependency mocks and package-adjacent,
   integration-tagged database tests with isolated migrated databases. Expose
   unit-only and full-suite Make targets and verify generated artifacts in CI.

## Delivery sequence

### 1. Establish the existing application's behavioral baseline

The first implementation PR adds Playwright coverage to the current application,
before replacing its runtime. Use a deterministic disposable database seeded with
ordinary users, an admin, representative templates, and courses. Use a controlled
OAuth provider fixture for callback tests; test-session seeding can accelerate
other scenarios but must not substitute for OAuth coverage. Test-only auth paths
must be unavailable in production.

| Flow | Required assertions |
| --- | --- |
| Public pages and authentication | Landing/privacy pages, protected-route redirects, both provider login callbacks, new-user provisioning, logout, expired sessions |
| Templates | Add/remove templates from a plan; create/rename/delete owned templates; requirement, instruction, separator, and fixed/free course behavior |
| Course selection | Search/filter, select/deselect, fill/change a free-course choice, and persistence after reload |
| Schedules | Create/rename/delete, assign/move/remove courses using the UI, change term range, reload persistence, and verify downloaded CSV content |
| Access and navigation | User isolation, admin allow/deny behavior, direct links, responsive navigation, and representative mobile scheduling interactions |

Use user-visible assertions and stable accessible selectors, with one small auth
fixture adapter for each runtime. Preserve the same behavior assertions through
the rewrite. Run core flows in Chromium plus focused Firefox/WebKit and mobile
coverage. Save failure traces/screenshots in CI. Capture existing broken behavior
explicitly; do not silently redefine it as successful migration behavior.

Exit: the baseline suite passes against the current app in CI, and every existing
route/action has an entry in a parity checklist with coverage or an explicit
verification procedure.

### 2. Build the API and data/auth transition

Add architecture guidance, domain packages, repositories, services, gateways,
Huma endpoints, OpenAPI generation, sqlc, mocks, and backend tests. Keep the current
app deployable while the API is introduced. Port each existing operation,
including provisioning and administrative authorization, with transactional
updates where consistency requires them. Exercise cross-user resource access at
the API boundary, not just through hidden UI controls.

Keep existing account IDs, provider account links, foreign keys, and stored
values. Introduce Goose through a verified baseline for an existing Drizzle-managed
database; do not replay initial schema creation against production or reset data.
Test both an empty database bootstrap and an upgrade from a representative legacy
database. Preserve expand-only compatibility while rollback to the old app is
required, and ensure only one migration runner owns schema changes at each stage.

Implement Google and GitHub OAuth, secure cookies, callback/state validation,
session expiry/logout, CSRF protection for cookie-authenticated mutations, and
existing role/ownership checks. Preserve callback URLs where feasible. Redis must
have health checks, bounded memory, restart behavior, and production configuration.

Authentication decision: the user accepts a one-time sign-in after cutover,
with accounts and saved data preserved. Start fresh Redis sessions on sign-in;
an active-session compatibility bridge is not required.

Exit: backend unit/integration tests pass; legacy data survives migration;
authentication and authorization are covered; generated artifacts reproduce
without differences.

### 3. Port the web application and prove feature parity

Build `web/` with React Router SSR. Use a same-origin web layer for authenticated
API access and keep business rules in Go. Generate the Orval client from Huma's
OpenAPI document and use it for application API calls. Port all routes and
interactions, retaining the existing design and functionality. Add appropriate
loading, error, and expired-session behavior, with server/browser code boundaries
that keep credentials out of browser bundles.

Run the behavioral suite against both implementations during the transition.
Check refresh/deep linking, mutations followed by navigation, course drag/drop,
CSV downloads, and stored data after application restarts. Port useful existing
unit tests; replace framework-specific tests with equivalent coverage.

Exit: all parity flows pass against the new stack, including negative access
cases and legacy fixture data, without weakened assertions or skipped failures.

### 4. Rehearse deployment, rollback, and telemetry

Extend CI with frontend lint/typecheck/build/tests, Go lint/unit/integration tests,
generation drift checks, Playwright, and production-container/Compose smoke tests.
Keep deployment-protocol, readiness, redaction, and migration-compatibility tests.

Build separate web and API images, identify both by immutable digests in one
release manifest, and update the restricted deployment protocol, host wrapper,
Compose configuration, and rollback state together. Stage a backward-compatible
deployer before releasing manifests that require the new protocol. Keep the
DigitalOcean/Tailscale deployment path, least-privileged credentials, database
volume, pre-migration backup, serialized release admission, and readiness checks.
Roll back the web/API pair together without reversing compatible schema changes.
Adapt the migrator to the Go artifact and validate service memory use within the
host's actual capacity. Intermediate merged PRs must remain deployable.

Export structured Go and web server logs via OTLP with service names
`uwplan-api` and `uwplan-web`, release identity, and trace/request correlation.
Preserve existing useful health metrics, tracing, and external readiness alerts;
update collector routing, dashboards, and queries for the new service names.
Never log cookies, tokens, database credentials, or OAuth callback secrets.
If browser telemetry is included, send it through a bounded same-origin endpoint
without exposing collector credentials.

Rehearse using production-shaped data and configuration: backup/restore, legacy
schema upgrade, OAuth callbacks, candidate readiness failure, and rollback of both
services after the candidate has written data. Verify restored data relationships
and usability, not just row counts. Emit a unique validation event and find its
web/API logs in Grafana/Loki, with correlated traces where applicable. Verify
collector failure does not prevent normal application requests.

Exit: a production-shaped deployment and failed-release rollback both pass;
Grafana contains the validation events; backup restoration works; no feature,
data, deployment, or logging blocker remains.

### 5. Cut over, verify production, and remove the old runtime

Merge passing, reviewable PRs in dependency order. Immediately before cutover,
verify backup/recovery readiness and deploy the tested immutable release through
CI/CD. Verify public routes, both real OAuth providers, saved-user flows, readiness,
the deployed revisions/digests, and Grafana ingestion. Use dedicated test data for
production write checks. Watch a defined initial 30-minute period for sustained
readiness or application errors; include telemetry ingestion delay in validation.

Remove Next.js, NextAuth, Drizzle runtime dependencies, obsolete server actions,
old application paths, and superseded scripts only when their replacements and
rollback procedure are proven. Retain migration history or a documented baseline
needed to reproduce existing databases. Keep previous immutable release artifacts
available for rollback.

Exit: latest main is fully migrated; required CI checks and deployment are green;
production parity and telemetry checks pass; cleanup is merged and deployed;
the runbook documents setup, generation, tests, migration, deployment, and recovery.
Report PRs, deployed revision, evidence, and any unresolved limitation. Do not
declare success based only on compilation or an HTTP health response.

## Execution authority and limits

After plan acceptance, the user authorizes creating and merging multiple PRs and
following their deployments. Merge only when required checks pass and each stage
is safe to deploy. Do not weaken branch protection or bypass failed checks.
Continue until the exit criteria are met; distinguish external blockers from
verified completion. Do not create a goal until the user requests starting it.
