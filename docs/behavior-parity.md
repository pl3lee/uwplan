# Rewrite behavior inventory

Baseline source: main at `982cee8`. Preserve these observable behaviors through
the rewrite. Browser assertions remain shared; new API tests also enforce direct
request authorization independently of what the UI exposes.

## Pages

| Route | Contract | Browser coverage |
| --- | --- | --- |
| `/`, `/privacy`, `/signin` | Public pages, both login choices | `planning.spec.ts` |
| `/api/auth/*` | Callback processing, provisioning, returning account, rejected unsolicited callback, logout/expiry | `auth.spec.ts`, `planning.spec.ts`; real provider smoke at cutover |
| `/select` | Template search/add/remove, fixed/free choices, normalization, select/remove, persistence | `planning.spec.ts` |
| `/schedule` | Schedule CRUD, final-schedule protection, term range, drag/drop, mobile assignment, CSV, private URLs | `scheduling.spec.ts`, `planning.spec.ts` |
| `/create/template` | Instruction/fixed/free/separator items, create and copy | `templates.spec.ts` |
| `/manage/template` | Own templates only, rename, cancel/confirm delete | `templates.spec.ts`, `planning.spec.ts` |
| `/admin` | Role restriction, user list, cross-owner template management | `planning.spec.ts`, `templates.spec.ts` |

## Server actions

| Current action | Replacement contract and evidence |
| --- | --- |
| `toggleUserTemplateAction` | Template membership and selection cleanup; browser persistence test |
| `updateFreeCourseAction` | User's free-course choice; browser choice test and API ownership test |
| `toggleCourseAction`, `removeCourseSelectionAction` | Select/deselect, including duplicates across templates; browser baseline and API duplicate-case tests |
| `createTemplateAction` | Validate item types, codes/counts and duplicate names; browser create/copy and API validation |
| `renameTemplateAction`, `deleteTemplateAction` | Owner/admin mutations; browser CRUD and direct API authorization |
| `createScheduleAction`, `changeScheduleNameAction`, `deleteScheduleAction` | CRUD, ownership and retain one schedule; browser management and API tests |
| `addCourseToScheduleAction`, `removeCourseFromScheduleAction` | Assignment/movement/removal, one assignment per course per schedule, ownership; drag/mobile and API tests |
| `changeTermRangeAction` | Persist valid season/year bounds; browser reload and API validation |
| `exportScheduleToCSV` | Selected-course and term-column sections; exact download assertion and API ownership |

## Operations

| Surface | Verification |
| --- | --- |
| `/api/live`, `/api/ready` | Go health/telemetry tests and `tests/rewrite-images.sh`; liveness during dependency failure, dependency readiness, redaction, and both release identities |
| Rehearsal readiness failure | `tests/paired-production-stack.py` uses a deliberately unhealthy test artifact to exercise real admission/rollback; no production readiness-control endpoint or auth bypass |
| Migrations, backups and deployment | `tests/test_production_deploy.py`, Go schema adoption tests, and the real paired migration/rollback/usable-restore rehearsal |
| Course refresh/seed commands | Go CLI tests cover controlled upstream responses, atomic catalog updates, reference preservation, and idempotent built-in seeding; the stored catalog is retained, while live refresh remains unverified because upstream returns HTTP 403 |
| Telemetry | Go/web OTLP and redaction tests plus unique production web/API events, linked Tempo spans, and fresh Mimir counters; see `migration-verification.md` |

## Baseline findings and replacement coverage

- Legacy schedule assignment/removal/export actions authenticated users without
  checking schedule ownership. The replacement service and repository enforce
  ownership, and direct API tests reject cross-owner assignment, removal, and CSV
  requests with the same 404 response used for unknown schedules.
- Duplicate course-selection cleanup is covered by service/repository tests;
  template copying remains in the shared browser assertions.
- The existing course tables offer sorting, and the template selector offers
  name search. There is no general course-search/filter control to preserve.

## Baseline regression found by browser tests

On the legacy production build, a course-selection action could save successfully
and return updated server-component data while the selected-course table retained
its old props. The same failure affected fixed-course toggles and changes to a
selected free course. The browser baseline asserts the visible result before
reloading, so it detects this failure rather than accepting persistence alone.

The legacy baseline uses the development server to capture intended behavior.
The pre-cleanup Git history retains the legacy production reproduction with
`E2E_PRODUCTION=1 npm run test:e2e`. Explicit router refreshes did not reliably fix this failure
and were removed. The production-only refresh failure remains unresolved in the
legacy runtime; it is not accepted as successful behavior for the replacement.
Run the complete unchanged behavior suite against the replacement production
build before cutover.

The course-selection flow now passes unchanged against the replacement production
build with the real Go API, PostgreSQL, and Redis in Chromium, Firefox, and WebKit.
This includes visible updates before reload, saved free-course changes, sorting,
selection removal, and template detachment. A delayed-save regression also verifies
character-by-character entry of a course whose prefix is another valid course,
including retained focus and the complete saved choice after reload. Scheduling also passes its original assertions against the replacement production
build: create/rename/delete with a retained final schedule, drag/move/remove,
term-range persistence, exact CSV export, and mobile navigation/assignment.
The shared response helper recognizes CSV downloads served by GET as well as
legacy action responses. Template creation/copy/rename/delete, owned-plan visibility, admin user listing,
and admin cross-owner rename now have replacement implementations too. The
complete 33-case suite also exercises Google/GitHub provisioning and returning
accounts through the production Go binary and isolated provider transport.
Run it with `pnpm test:e2e`; CI requires every case. Real provider
sign-in and stored data after application restarts remain cutover/rehearsal checks.

The baseline also found that the drag context generated different accessibility
IDs during SSR and hydration. A stable ID derived from the active schedule fixes
the mismatch, including the development error badge that covered mobile
navigation. The browser drag/drop and mobile assignment flows cover the fix.

A release-run WebKit trace also exposed a free-course input accepting text after
a reload before its React change handler was ready. No mutation request followed
the fill. Disable that field until hydration finishes so early user input cannot
be discarded. The existing reload-and-change browser assertion covers this case.

## Catalog navigation regression

Select renders its authenticated layout immediately and loads course data from
the browser query cache, with explicit initial loading and retry states. The
production-sized catalog regression verifies that SSR HTML excludes the catalog,
three Select/Schedule round trips reuse it beyond the previous 30-second cache
window, and a delayed background refresh leaves saved rows usable. Course
selection, free-course typing, previews, and mutation invalidation retain their
existing behavior. `pnpm test:e2e` now runs 35 cases, including initial catalog
failure recovery.

## Optimistic scheduling regression

The replacement scheduler initially waited for the save and query refresh before
moving a course. It now previews assignment, movement, and removal immediately,
keeps the preview through a delayed refresh, and restores the saved position on
failure. Desktop browser tests hold both requests open, reject each operation,
retry against the real API, and check persistence after reload. The mobile term
selector also verifies immediate feedback, rollback, and retry. These additions
bring the shared suite to 40 cases.
