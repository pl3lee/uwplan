-- name: ListOwnedSchedules :many
SELECT s.id,s.name FROM schedule s JOIN plan p ON p.id=s.plan_id WHERE p.user_id=$1 ORDER BY s.id;

-- name: CreateOwnedSchedule :one
INSERT INTO schedule(id,name,plan_id) SELECT $1,$2,p.id FROM plan p WHERE p.user_id=$3 RETURNING id,name;

-- name: RenameOwnedSchedule :execrows
UPDATE schedule s SET name=$3 FROM plan p WHERE s.plan_id=p.id AND p.user_id=$1 AND s.id=$2;

-- name: LockOwnedPlan :one
SELECT id FROM plan WHERE user_id=$1 FOR UPDATE;

-- name: DeleteOwnedSchedule :execrows
DELETE FROM schedule s USING plan p WHERE s.plan_id=p.id AND p.user_id=$1 AND s.id=$2;
