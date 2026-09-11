-- name: ListTemplates :many
SELECT * FROM template WHERE NOT sqlc.arg(owned_only)::boolean OR created_by=sqlc.arg(actor_id)::text ORDER BY name;

-- name: GetTemplate :one
SELECT * FROM template WHERE id=$1;

-- name: CreateTemplate :one
INSERT INTO template(id,name,description,created_by) VALUES($1,$2,$3,$4) RETURNING *;

-- name: CreateBuiltinTemplate :one
INSERT INTO template(id,name,description,created_by) VALUES($1,$2,$3,NULL)
ON CONFLICT(name) DO NOTHING RETURNING *;

-- name: GetTemplateByName :one
SELECT * FROM template WHERE name=$1;

-- name: ListTemplateItems :many
SELECT * FROM template_item WHERE template_id=$1 ORDER BY order_index,id;

-- name: ListTemplateCourseItems :many
SELECT ci.id,ci.requirement_id,ci.type,ci.course_id,c.code AS course_code FROM course_item ci
JOIN template_item ti ON ti.id=ci.requirement_id LEFT JOIN course c ON c.id=ci.course_id
WHERE ti.template_id=$1 ORDER BY ci.id;

-- name: CreateTemplateItem :exec
INSERT INTO template_item(id,template_id,type,description,order_index) VALUES($1,$2,$3,$4,$5);

-- name: CreateFixedTemplateCourse :one
INSERT INTO course_item(id,requirement_id,type,course_id)
SELECT sqlc.arg(id),sqlc.arg(requirement_id),'fixed',c.id FROM course c WHERE c.code=sqlc.arg(code) RETURNING id;

-- name: CreateFreeTemplateCourse :exec
INSERT INTO course_item(id,requirement_id,type) VALUES($1,$2,'free');

-- name: RenameManagedTemplate :execrows
UPDATE template SET name=sqlc.arg(name),description=sqlc.narg(description)
WHERE id=sqlc.arg(id) AND (created_by=sqlc.arg(actor_id)::text OR sqlc.arg(is_admin)::boolean);

-- name: DeleteManagedTemplate :execrows
DELETE FROM template WHERE id=sqlc.arg(id) AND (created_by=sqlc.arg(actor_id)::text OR sqlc.arg(is_admin)::boolean);
