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

-- name: GetOwnedSchedule :one
SELECT s.id,s.name FROM schedule s JOIN plan p ON p.id=s.plan_id WHERE p.user_id=$1 AND s.id=$2;

-- name: ListScheduleAssignments :many
SELECT sqlc.embed(c),sc.term FROM schedule_course sc JOIN course c ON c.id=sc.course_id WHERE sc.schedule_id=$1 ORDER BY c.code;

-- name: ListSelectedCatalogCourses :many
SELECT sqlc.embed(c) FROM selected_course selected
JOIN plan p ON p.id=selected.plan_id
JOIN course_item item ON item.id=selected.course_item_id
LEFT JOIN free_course free ON free.course_item_id=item.id AND free.user_id=p.user_id
JOIN course c ON c.id=CASE WHEN item.type='fixed' THEN item.course_id ELSE free.filled_course_id END
WHERE p.user_id=$1 AND selected.selected=true ORDER BY c.code,item.id;

-- name: AssignOwnedScheduleCourse :execrows
INSERT INTO schedule_course(schedule_id,course_id,term)
SELECT s.id,c.id,sqlc.arg(term) FROM schedule s JOIN plan p ON p.id=s.plan_id JOIN course c ON c.id=sqlc.arg(course_id)
WHERE p.user_id=sqlc.arg(user_id) AND s.id=sqlc.arg(schedule_id)
ON CONFLICT(schedule_id,course_id) DO UPDATE SET term=excluded.term;

-- name: RemoveOwnedScheduleCourse :execrows
DELETE FROM schedule_course sc USING schedule s,plan p WHERE sc.schedule_id=s.id AND s.plan_id=p.id AND p.user_id=$1 AND s.id=$2 AND sc.course_id=$3;

-- name: GetUserTermRange :one
SELECT start_term,start_year,end_term,end_year FROM user_term_range WHERE user_id=$1;

-- name: UpdateUserTermRange :execrows
UPDATE user_term_range SET start_term=$2,start_year=$3,end_term=$4,end_year=$5 WHERE user_id=$1;
