#!/usr/bin/env bash
set -euo pipefail

# Disposable integration stack using the same Compose file as DigitalOcean.
: "${UWPLAN_IMAGE:?Set UWPLAN_IMAGE to the built candidate}"
work_directory="$(mktemp -d)"
export UWPLAN_CONFIG_DIR="$work_directory"
export RELEASE_DIGEST="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
export RELEASE_REVISION
RELEASE_REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$UWPLAN_IMAGE")"
project="uwplan-production-test-${GITHUB_RUN_ID:-local}-$$"
compose() {
  docker compose --project-name "$project" --file ops/production/compose.yaml "$@"
}
cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}
trap cleanup EXIT
umask 077
printf '%s' 'disposable-admin-password' > "$work_directory/postgres-admin-password"
cat > "$work_directory/app.env" <<'EOF'
AUTH_SECRET=disposable-auth-secret
AUTH_GOOGLE_ID=disposable-google-id
AUTH_GOOGLE_SECRET=disposable-google-secret
AUTH_GITHUB_ID=disposable-github-id
AUTH_GITHUB_SECRET=disposable-github-secret
AUTH_TRUST_HOST=true
DATABASE_URL=postgresql://uwplan_app:disposable-app-password@db:5432/uwplan
EOF
printf '%s\n' 'DATABASE_URL=postgresql://postgres:disposable-admin-password@db:5432/uwplan' > "$work_directory/migrator.env"

compose config --quiet
compose up --detach --wait db
compose --profile migration run --rm --no-deps migrator
compose exec -T db psql -U postgres -d uwplan -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE uwplan_app LOGIN PASSWORD 'disposable-app-password';
GRANT USAGE ON SCHEMA public TO uwplan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uwplan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uwplan_app;
SQL
compose up --detach --wait app
[[ "$(compose port app 5000)" == '127.0.0.1:5002' ]]
[[ -z "$(docker port "$(compose ps -q db)")" ]]

check_ready() {
  curl --fail --silent --show-error http://127.0.0.1:5002/api/ready |
    jq -e --arg digest "$RELEASE_DIGEST" --arg revision "$RELEASE_REVISION" '
      .status == "ready" and .dependencies.database == "available" and
      .release == {digest: $digest, revision: $revision}'
}
check_ready

# Use the application's restricted role to exercise real schema writes.
compose exec -T db psql -U uwplan_app -d uwplan -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "user" (id,email) VALUES ('production-ci-user','production-ci@example.invalid');
INSERT INTO plan (id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','production-ci-user');
SQL
[[ "$(compose exec -T db psql -U postgres -d uwplan -Atc "SELECT rolsuper FROM pg_roles WHERE rolname='uwplan_app'")" == 'f' ]]

compose exec -T db pg_dump -U postgres -d uwplan -Fc --no-owner --no-acl > "$work_directory/backup.dump"
compose exec -T db createdb -U postgres restore_probe
compose exec -T db pg_restore -U postgres -d restore_probe --no-owner --no-acl --exit-on-error < "$work_directory/backup.dump"
[[ "$(compose exec -T db psql -U postgres -d restore_probe -Atc "SELECT user_id FROM plan WHERE id='11111111-1111-4111-8111-111111111111'")" == 'production-ci-user' ]]

# Recreate containers without removing volumes, then prove persistence/readiness.
compose down
compose up --detach --wait
check_ready
[[ "$(compose exec -T db psql -U uwplan_app -d uwplan -Atc "SELECT user_id FROM plan WHERE id='11111111-1111-4111-8111-111111111111'")" == 'production-ci-user' ]]

docker run --rm --volume "$PWD/ops/production/Caddyfile:/etc/caddy/Caddyfile:ro" \
  docker.io/library/caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 \
  caddy validate --config /etc/caddy/Caddyfile
echo 'Production Compose, restricted database role, migrations, backup restore, persistence and Caddy validation passed'
