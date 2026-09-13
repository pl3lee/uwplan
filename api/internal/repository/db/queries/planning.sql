-- All selection and assignment writers take the shared gate before a plan row.
-- Template deletion takes it exclusively before discovering/locking plans, so
-- membership cannot change underneath discovery and lock order cannot invert.
-- name: LockPlanningMutation :exec
SELECT pg_advisory_xact_lock_shared(hashtextextended('uwplan:planning:templates',0));

-- name: LockTemplateDeletion :exec
SELECT pg_advisory_xact_lock(hashtextextended('uwplan:planning:templates',0));

-- name: LockTemplatePlans :many
SELECT p.id FROM plan p JOIN plan_template pt ON pt.plan_id=p.id
WHERE pt.template_id=$1 ORDER BY p.id FOR UPDATE OF p;

-- name: ReconcilePlanAssignments :exec
DELETE FROM schedule_course assignment USING schedule s
WHERE assignment.schedule_id=s.id AND s.plan_id=$1 AND NOT EXISTS (
    SELECT 1 FROM active_course_sources source
    WHERE source.plan_id=s.plan_id AND source.course_id=assignment.course_id
);
