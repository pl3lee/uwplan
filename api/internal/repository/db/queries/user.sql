-- name: GetUser :one
SELECT id, email, name, image, role FROM "user" WHERE id=$1;

-- name: GetProviderUser :one
SELECT u.id, u.email, u.name, u.image, u.role FROM "user" u JOIN account a ON a.user_id=u.id WHERE a.provider=$1 AND a.provider_account_id=$2;

-- name: EmailExists :one
SELECT EXISTS(SELECT 1 FROM "user" WHERE lower(email)=lower($1::text));

-- name: LockIdentity :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text,0));

-- name: CreateUser :one
INSERT INTO "user"(id,email,name,image) VALUES ($1,$2,$3,$4) RETURNING id,email,name,image,role;

-- name: CreateProviderAccount :exec
INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ($1,'oauth',$2,$3);

-- name: CreatePlan :exec
INSERT INTO plan(id,user_id) VALUES ($1,$2);

-- name: CreateDefaultSchedule :exec
INSERT INTO schedule(id,name,plan_id) VALUES ($1,'Default',$2);

-- name: CreateDefaultTermRange :exec
INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ($1,'Fall',$2,'Fall',$2+5);
