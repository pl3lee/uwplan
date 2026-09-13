# Planning integrity and schema evolution

Goose migration 2 repairs the five findings in the
[September 2026 audit](database-schema-audit-2026-09-13.md). Baseline migration 1,
its legacy schema/fingerprint, and the retained Drizzle history remain immutable.

## Selection and scheduling

`plan_course_choices` resolves attached template slots into user-specific choices,
including unfilled and deselected slots. `active_course_sources` selects the rows
whose flag is true and resolved catalog course is present. Select and Schedule
use these views, and assignment eligibility and reconciliation use the same
active-source relation. Multiple sources can resolve to the same catalog course.
CSV retains those occurrences; schedule placement remains unique per course.

All selection and assignment writes take the shared `uwplan:planning:templates`
transaction advisory lock before locking the owned plan row. Template deletion
takes the advisory lock exclusively, discovers affected plans, locks them in ID
order, deletes the template, and reconciles every affected plan before commit.
This prevents concurrent membership additions from escaping affected-plan
discovery and avoids inverting plan/template lock order. Normal writes for
different users remain concurrent; deleting a shared definition briefly excludes
all selection/assignment writers. Schedule-only deletion already locks its plan
and does not wait for the template gate.

Detachment, deselection, replacement, clearing, and definition deletion remove
assignments only when their last active source disappears. Explicit course
removal removes all its sources and placements. Dormant free-slot contents remain
available after reattachment; they do not silently reselect the slot. Assignment
of an unselected course returns the same 404 as an unavailable course/schedule.

These lifecycle guarantees belong to the transactional repositories. Direct SQL
writers must maintain them as well; a catalog foreign key alone does not enforce
selection eligibility. Retained application rollback remains readable/writable,
but naturally retains that older application's lifecycle behavior.

## Constraints and positions

The migration enforces fixed/free slot shape, requirement-only parents, free-only
fills, valid academic terms/year bounds, case-insensitive email uniqueness, and
distinct nonnegative positions. Composite foreign keys with constant defaulted
discriminators enforce parent subtypes without cross-table CHECK functions.
New indexes cover parent/reverse-reference traversal; redundant course-code and
requirement-parent indexes and the unused global term index are removed.

Template blocks are renumbered in their current `(order_index,id)` display order.
Course slots are assigned positions in their current UUID display order. IDs,
references, and displayed order survive the backfill. New API writes provide
explicit positions; legacy inserts omit them, so a trigger locks the parent and
appends a position. The trigger runs with the caller's privileges. Colliding
emails or invalid values outside the legacy exceptions below stop migration
rather than guessing which identity or saved data to discard.

Production admission exposed two historical exceptions: free slots containing an
unused `course_id`, and reversed saved term ranges. Their shape/range CHECKs use
`NOT VALID`: PostgreSQL preserves existing rows and enforces the rules on new or
updated rows. The user's free-course fill still determines the active course;
the legacy slot reference is retained verbatim. Range endpoints are also retained
verbatim. Do not run `VALIDATE CONSTRAINT` until these records have been explicitly
repaired with a data-preserving policy. This is deferred validation of historical
data, not a claim that all stored rows satisfy the new rules.

The first production attempt applied none of migration 2 (Goose remained at
version 1). Its SQL was corrected while that production migration remained pending;
baseline 1 is unchanged. Databases that already applied version 2 successfully
already satisfy these two checks and need no data repair for them.

## Startup, deployment, and rollback

The API invokes the same Goose Up implementation as `/app/migrate` before opening
HTTP, with a five-minute bound and process cancellation. Goose's PostgreSQL
session lock serializes concurrent startup/migrator processes. Failure exits
without accepting traffic; logs omit database URLs and database error details.
The migration checksum used by pgtestdb includes every embedded SQL migration.
sqlc loads the immutable baseline followed by the ordered Goose SQL migrations.

Production admission retains its pre-migration backup and owner-role migrator.
The restricted runtime calls Up as well; when the schema is current, it requires
only its existing version-table read access. It is not given schema ownership.
Pending DDL under a restricted runtime fails closed: admission must run the
owner-role migrator first. Local installations using an owning database role
bootstrap or upgrade automatically. Newly introduced invoker views inherit
explicit SELECT grants from `selected_course` readers during migration.

Application rollback keeps the expanded schema and candidate writes. Migration 2
is deliberately forward-only because deleted orphan assignments and historical
ambiguous positions cannot be reconstructed by a Down migration. The retained
release can omit all new columns on inserts. Do not remove those compatibility
defaults/triggers while that release remains supported.

## Release checks

1. Run generation, API unit/integration tests, web checks/tests, and the full
   production-build Playwright suite. The browser runner relies on API startup
   to migrate its empty, isolated PostgreSQL database.
2. Rehearse legacy adoption/upgrade and paired rollback/backup restoration with
   the retained artifact. Include existing selected/scheduled relationships and
   legacy writes that omit the new columns.
3. Before admission, inspect migration failures in an isolated restored backup
   if existing constraint violations are suspected. The retained fixture includes
   legacy free-slot metadata and a reversed range and compares both verbatim
   through migration, application rollback, and backup restoration. Resolve email collisions by
   an explicit account-linking decision; never auto-merge accounts by email.
