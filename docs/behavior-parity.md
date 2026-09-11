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
| `/api/live`, `/api/ready` | Existing HTTP/production-stack tests; liveness during DB failure, dependency readiness and release identity |
| Rehearsal readiness control | Existing HTTP tests; retain access controls and production gating |
| Migrations, backups and deployment | Existing deployment tests plus legacy-to-Go migration, restore, and paired-image rollback rehearsal |
| Course refresh/seed commands | Port CLI entry points and test a controlled upstream fixture; retain the real catalog |
| Telemetry | Existing contracts plus unique web/API events found in Grafana after deployment |

## Gaps to resolve

- Source inspection found schedule assignment/removal/export actions authenticate
  users without checking schedule ownership. Direct-request regression tests must
  catch cross-owner access; UI-only visibility tests are insufficient.
- Verify duplicate course-selection cleanup and template-copy behavior explicitly
  when porting services.
- The existing course tables offer sorting, and the template selector offers
  name search. There is no general course-search/filter control to preserve.

## Baseline regression found by browser tests

On the legacy production build, a course-selection action could save successfully
and return updated server-component data while the selected-course table retained
its old props. The same failure affected fixed-course toggles and changes to a
selected free course. The browser baseline asserts the visible result before
reloading, so it detects this failure rather than accepting persistence alone.

The legacy baseline uses the development server to capture intended behavior.
`E2E_PRODUCTION=1 npm run test:e2e` preserves a reproduction against the legacy
production build. Explicit router refreshes did not reliably fix this failure
and were removed. The production-only refresh failure remains unresolved in the
legacy runtime; it is not accepted as successful behavior for the replacement.
Run the complete unchanged behavior suite against the replacement production
build before cutover.

The baseline also found that the drag context generated different accessibility
IDs during SSR and hydration. A stable ID derived from the active schedule fixes
the mismatch, including the development error badge that covered mobile
navigation. The browser drag/drop and mobile assignment flows cover the fix.

A release-run WebKit trace also exposed a free-course input accepting text after
a reload before its React change handler was ready. No mutation request followed
the fill. Disable that field until hydration finishes so early user input cannot
be discarded. The existing reload-and-change browser assertion covers this case.
