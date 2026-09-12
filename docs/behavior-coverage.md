# Behavior coverage

Preserve the user-visible contracts below. Browser tests exercise the production
Go API and React Router build; API tests enforce authorization independently of
what the UI exposes. Run the complete suite with `pnpm test:e2e` before release.

## Pages

| Route | Contract | Browser coverage |
| --- | --- | --- |
| `/`, `/privacy`, `/signin` | Public pages, both login choices | `planning.spec.ts` |
| `/api/auth/*` | Provider callbacks, provisioning, returning accounts, rejected unsolicited callbacks, logout and expiry | `auth.spec.ts`, `planning.spec.ts`; real-provider production verification |
| `/select` | Template search/add/remove, fixed/free choices, select/remove, persistence | `planning.spec.ts` |
| `/schedule` | Schedule CRUD, final-schedule protection, drag/drop, mobile assignment, term range, CSV, private URLs | `scheduling.spec.ts`, `planning.spec.ts` |
| `/create/template` | Instruction/fixed/free/separator items; create and copy | `templates.spec.ts` |
| `/manage/template` | Owned templates; rename, cancel and confirm delete | `templates.spec.ts`, `planning.spec.ts` |
| `/admin` | Role restriction, user list, cross-owner template management | `planning.spec.ts`, `templates.spec.ts` |

## API behavior

| Operation | Contract and evidence |
| --- | --- |
| Template membership | Add/remove templates and clean up related selections; browser persistence and API tests |
| Free-course choices | Fill/change owned choices; browser typing/reload and API ownership tests |
| Course selection | Select/deselect, including duplicates across templates; browser state and API duplicate-case tests |
| Template creation/copy | Validate types, codes/counts and duplicate names; preserve item ordering and ownership |
| Template rename/delete | Owner/admin mutations; browser CRUD and direct API authorization |
| Schedule create/rename/delete | Enforce ownership and retain one schedule; browser management and API tests |
| Course assignment/movement/removal | One assignment per course per schedule; desktop/mobile behavior and API ownership tests |
| Term range | Persist valid season/year bounds; browser reload and API validation |
| CSV export | Selected-course and term-column sections; exact downloaded content and API ownership tests |

Cross-owner assignment, removal, and CSV requests return the same 404 response as
unknown schedules. Duplicate selection cleanup and template copying remain
covered. Course tables support sorting, and the template selector supports name
search.

## Regression coverage

Course selection must update visibly before reload, including fixed-course
toggles, free-course choices, removal, and template detachment. Delayed saves must
preserve complete character-by-character course input and focus, including when
one course code is a prefix of another. Inputs remain disabled until hydration
so early typing cannot be discarded.

Scheduling tests verify immediate previews for assignment, movement, and removal
while saves and refreshes are delayed. Rejected mutations restore the saved
position and permit retry; successful saves retain their confirmed state if the
following refresh fails. Mobile term selection has the same rollback/retry
contract. Stable drag-context IDs keep SSR and hydration consistent. Tests also
check term-range persistence, reload behavior, and exact CSV downloads.

Select renders its authenticated layout immediately and loads the catalog through
the browser query cache. The production-sized catalog regression verifies that
SSR HTML excludes the catalog, repeated Select/Schedule navigation reuses cached
data, and delayed background refresh leaves saved rows usable. Initial loading
and failed-request retry states are covered.

Google/GitHub browser tests cover provisioning and returning accounts using the
production API binary and isolated provider transport. Real-provider sign-in and
stored data after application restarts are separate production checks.

## Operations

| Surface | Verification |
| --- | --- |
| `/api/live`, `/api/ready` | Go health/telemetry tests and `tests/rewrite-images.sh`; liveness during dependency failure, readiness, redaction, both release identities |
| Failed release admission | `tests/paired-production-stack.py` uses an unhealthy fixture artifact to exercise real admission and rollback |
| Migrations, backups and deployment | `tests/test_production_deploy.py`, Go schema adoption tests, and migration/rollback/usable-restore rehearsal |
| Course refresh/seed | Controlled upstream responses, atomic catalog updates, reference preservation, idempotent seeding; live refresh remains unverified after upstream HTTP 403 |
| Telemetry | Go/web OTLP and redaction tests, collector routing/durable queue tests, and correlated production web/API records in PostHog |

Follow the [production runbook](../ops/production/README.md) for release checks and
[production verification](production-verification.md) for recorded evidence.
