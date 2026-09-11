-- name: GetOwnedPlan :one
SELECT id FROM plan WHERE user_id=$1;

-- name: ListPlanTemplateIDs :many
SELECT pt.template_id FROM plan_template pt JOIN template t ON t.id=pt.template_id WHERE pt.plan_id=$1 ORDER BY t.name,t.id;

-- name: ListPlanChoices :many
SELECT ci.id,ci.type,ci.course_id,fc.filled_course_id,
       COALESCE(sc.selected,false)::boolean AS selected
FROM plan p
JOIN plan_template pt ON pt.plan_id=p.id
JOIN template_item ti ON ti.template_id=pt.template_id
JOIN course_item ci ON ci.requirement_id=ti.id
LEFT JOIN selected_course sc ON sc.plan_id=p.id AND sc.course_item_id=ci.id
LEFT JOIN free_course fc ON fc.user_id=p.user_id AND fc.course_item_id=ci.id
WHERE p.id=$1 ORDER BY ci.id;

-- name: LockAvailableTemplate :one
SELECT id FROM template WHERE id=$1 FOR KEY SHARE;

-- name: AttachPlanTemplate :exec
INSERT INTO plan_template(plan_id,template_id) VALUES ($1,$2) ON CONFLICT DO NOTHING;

-- name: DetachPlanTemplate :exec
DELETE FROM plan_template WHERE plan_id=$1 AND template_id=$2;

-- name: DeselectTemplateChoices :exec
UPDATE selected_course sc SET selected=false FROM course_item ci,template_item ti
WHERE sc.course_item_id=ci.id AND ci.requirement_id=ti.id AND sc.plan_id=$1 AND ti.template_id=$2;

-- name: SetPlanChoice :execrows
INSERT INTO selected_course(plan_id,course_item_id,selected)
SELECT pt.plan_id,ci.id,sqlc.arg(selected) FROM plan_template pt
JOIN template_item ti ON ti.template_id=pt.template_id
JOIN course_item ci ON ci.requirement_id=ti.id
WHERE pt.plan_id=sqlc.arg(plan_id) AND ci.id=sqlc.arg(course_item_id)
ON CONFLICT(plan_id,course_item_id) DO UPDATE SET selected=excluded.selected;

-- name: LockPlanFreeCourseItem :one
SELECT ci.id FROM plan_template pt
JOIN template_item ti ON ti.template_id=pt.template_id
JOIN course_item ci ON ci.requirement_id=ti.id
WHERE pt.plan_id=$1 AND ci.id=$2 AND ci.type='free' FOR KEY SHARE OF ci;

-- name: FillFreeCourse :execrows
INSERT INTO free_course(id,user_id,course_item_id,filled_course_id)
SELECT sqlc.arg(id),sqlc.arg(user_id),sqlc.arg(course_item_id),c.id FROM course c WHERE c.id=sqlc.arg(course_id)
ON CONFLICT(course_item_id,user_id) DO UPDATE SET filled_course_id=excluded.filled_course_id;

-- name: ClearFreeCourse :exec
DELETE FROM free_course WHERE user_id=$1 AND course_item_id=$2;

-- name: RemoveSelectedCourse :exec
DELETE FROM selected_course sc USING course_item ci
LEFT JOIN free_course fc ON fc.course_item_id=ci.id AND fc.user_id=sqlc.arg(user_id)
WHERE sc.plan_id=sqlc.arg(plan_id) AND sc.course_item_id=ci.id
AND ((ci.type='fixed' AND ci.course_id=sqlc.arg(course_id)::uuid) OR (ci.type='free' AND fc.filled_course_id=sqlc.arg(course_id)::uuid));

-- name: RemoveCourseFromPlanSchedules :exec
DELETE FROM schedule_course sc USING schedule s
WHERE sc.schedule_id=s.id AND s.plan_id=$1 AND sc.course_id=$2;
