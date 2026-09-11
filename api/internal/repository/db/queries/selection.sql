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
