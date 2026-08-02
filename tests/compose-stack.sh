#!/usr/bin/env bash
set -euo pipefail

readonly COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
readonly UWPLAN_IMAGE="${UWPLAN_IMAGE:?Set UWPLAN_IMAGE to the already-built test image}"
readonly PROJECT_NAME="${COMPOSE_PROJECT_NAME:-uwplan-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}}"
readonly CADDY_IMAGE="docker.io/library/caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
readonly RELEASE_DIGEST="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
readonly RELEASE_REVISION="compose-contract-test"
readonly DB_PASSWORD="ci-compose-database-secret-must-not-leak"
readonly DB_ADMIN_PASSWORD="ci-compose-admin-secret-must-not-leak"
readonly BAD_DB_PASSWORD="ci-compose-invalid-secret-must-not-leak"
readonly CADDY_HTTPS_PORT="18443"
readonly CADDY_WWW_PORT="18444"

work_directory="$(mktemp -d)"
neighbor_name="${PROJECT_NAME}-neighbor"
caddy_name="${PROJECT_NAME}-caddy"
app_environment="${work_directory}/app.env"
alloy_environment="${work_directory}/alloy.env"
postgres_password_file="${work_directory}/postgres-password"
postgres_admin_password_file="${work_directory}/postgres-admin-password"
migration_success_log="${work_directory}/migration-success.log"
migration_failure_log="${work_directory}/migration-failure.log"
root_certificate="${work_directory}/caddy-root.crt"

compose() {
  UWPLAN_IMAGE="$UWPLAN_IMAGE" \
  UWPLAN_ENV_FILE="$app_environment" \
  UWPLAN_ALLOY_ENV_FILE="$alloy_environment" \
  POSTGRES_PASSWORD_FILE="$postgres_password_file" \
  POSTGRES_ADMIN_PASSWORD_FILE="$postgres_admin_password_file" \
  RELEASE_DIGEST="$RELEASE_DIGEST" \
  RELEASE_REVISION="$RELEASE_REVISION" \
    docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

assert_app_health() {
  local app_container
  app_container="$(compose ps --quiet app)"
  [[ -n "$app_container" ]]
  docker inspect --format '{{json .Config.Healthcheck.Test}}' "$app_container" \
    | grep --fixed-strings '/api/live'
  docker inspect --format '{{.State.Health.Status}}' "$app_container" \
    | grep --fixed-strings healthy
  docker inspect --format '{{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "syslog-format"}}' "$app_container" \
    | grep --fixed-strings 'syslog rfc5424micro'
}

cleanup() {
  docker rm --volumes --force "$caddy_name" "$neighbor_name" >/dev/null 2>&1 || true
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}
trap cleanup EXIT

docker info >/dev/null
chmod 700 "$work_directory"
printf '%s' "$DB_PASSWORD" > "$postgres_password_file"
chmod 600 "$postgres_password_file"
printf '%s' "$DB_ADMIN_PASSWORD" > "$postgres_admin_password_file"
chmod 600 "$postgres_admin_password_file"
cat > "$app_environment" <<EOF
AUTH_GITHUB_ID=compose-github-id
AUTH_GITHUB_SECRET=compose-github-secret
AUTH_GOOGLE_ID=compose-google-id
AUTH_GOOGLE_SECRET=compose-google-secret
AUTH_SECRET=compose-auth-secret
AUTH_TRUST_HOST=true
DATABASE_URL=postgresql://uwplan_app:${DB_PASSWORD}@db:5432/uwplan
EOF
chmod 600 "$app_environment"
cat > "$alloy_environment" <<EOF
UWPLAN_REMOTE_OTLP_ENDPOINT=127.0.0.1:4317
UWPLAN_REMOTE_OTLP_TOKEN=ci-otlp-token
UWPLAN_REMOTE_LOKI_URL=http://127.0.0.1:9/loki/api/v1/push
UWPLAN_REMOTE_LOKI_TOKEN=ci-loki-token
UWPLAN_REMOTE_PROMETHEUS_URL=http://127.0.0.1:9/api/v1/push
UWPLAN_REMOTE_PROMETHEUS_TOKEN=ci-prometheus-token
UWPLAN_EXTERNAL_READINESS_URL=https://localhost:${CADDY_HTTPS_PORT}/api/ready
EOF
chmod 600 "$alloy_environment"

docker pull "$CADDY_IMAGE" >/dev/null
docker run --rm \
  --volume "$(pwd)/ops/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" adapt --config /etc/caddy/Caddyfile --adapter caddyfile \
  --validate >/dev/null
docker run --rm \
  --env "UWPLAN_CADDY_APEX=https://localhost:${CADDY_HTTPS_PORT}" \
  --env "UWPLAN_CADDY_WWW=https://www.localhost:${CADDY_WWW_PORT}" \
  --env "UWPLAN_CADDY_CANONICAL_URL=https://localhost:${CADDY_HTTPS_PORT}" \
  --env "UWPLAN_CADDY_TLS_DIRECTIVE=tls internal" \
  --volume "$(pwd)/ops/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" adapt --config /etc/caddy/Caddyfile --adapter caddyfile \
  --validate >/dev/null
docker run --detach --name "$neighbor_name" --entrypoint /bin/sh "$CADDY_IMAGE" \
  -c 'while true; do sleep 3600; done' >/dev/null

compose up --detach --wait db alloy
compose --profile migration run --rm migrator > "$migration_success_log" 2>&1
grep --fixed-strings '"event":"database.migration"' "$migration_success_log"
grep --fixed-strings '"status":"success"' "$migration_success_log"
if grep --fixed-strings --quiet "$DB_PASSWORD" "$migration_success_log"; then
  echo "Successful migration evidence leaked the database credential" >&2
  exit 1
fi
compose up --detach --wait app
assert_app_health

published_address="$(compose port app 5000)"
if [[ "$published_address" != "127.0.0.1:5000" ]]; then
  echo "Application was not published only on loopback: $published_address" >&2
  exit 1
fi

compose exec --no-TTY db psql --username uwplan_app --dbname uwplan \
  --set ON_ERROR_STOP=1 \
  --command "create table if not exists compose_persistence_probe (value text primary key); insert into compose_persistence_probe values ('survives-lifecycle') on conflict do nothing;"

compose stop
docker inspect --format '{{.State.Running}}' "$neighbor_name" | grep --fixed-strings true
compose up --detach --wait db alloy
compose --profile migration run --rm migrator > /dev/null
compose up --detach --wait app
compose exec --no-TTY db psql --username uwplan_app --dbname uwplan \
  --tuples-only --no-align --command "select value from compose_persistence_probe" \
  | grep --fixed-strings survives-lifecycle

compose down
docker inspect --format '{{.State.Running}}' "$neighbor_name" | grep --fixed-strings true
compose up --detach --wait db alloy
compose --profile migration run --rm migrator > /dev/null
compose up --detach --wait app
compose exec --no-TTY db psql --username uwplan_app --dbname uwplan \
  --tuples-only --no-align --command "select value from compose_persistence_probe" \
  | grep --fixed-strings survives-lifecycle

set +e
compose --profile migration run --rm \
  --env "DATABASE_URL=postgresql://uwplan_app:${BAD_DB_PASSWORD}@db:5432/uwplan" \
  migrator > "$migration_failure_log" 2>&1
migration_failure_status=$?
set -e
if [[ "$migration_failure_status" -eq 0 ]]; then
  echo "Migrator unexpectedly accepted invalid credentials" >&2
  exit 1
fi
grep --fixed-strings '"event":"database.migration"' "$migration_failure_log"
grep --fixed-strings '"status":"failure"' "$migration_failure_log"
if grep --fixed-strings --quiet "$BAD_DB_PASSWORD" "$migration_failure_log"; then
  echo "Failed migration evidence leaked the database credential" >&2
  exit 1
fi

docker run --detach --name "$caddy_name" --network host \
  --env "UWPLAN_CADDY_APEX=https://localhost:${CADDY_HTTPS_PORT}" \
  --env "UWPLAN_CADDY_WWW=https://www.localhost:${CADDY_WWW_PORT}" \
  --env "UWPLAN_CADDY_CANONICAL_URL=https://localhost:${CADDY_HTTPS_PORT}" \
  --env "UWPLAN_CADDY_TLS_DIRECTIVE=tls internal" \
  --volume "$(pwd)/ops/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  --volume /data \
  "$CADDY_IMAGE" >/dev/null

for _ in {1..30}; do
  docker exec "$caddy_name" test -f /data/caddy/pki/authorities/local/root.crt \
    >/dev/null 2>&1 && break
  sleep 1
done
if ! docker exec "$caddy_name" test -f /data/caddy/pki/authorities/local/root.crt; then
  docker logs "$caddy_name" >&2
  echo "Caddy did not issue its disposable integration certificate" >&2
  exit 1
fi
docker cp "$caddy_name:/data/caddy/pki/authorities/local/root.crt" \
  "$root_certificate" >/dev/null

ready_body="${work_directory}/ready.json"
ready_status=""
for _ in {1..30}; do
  ready_status="$(curl --silent --show-error --cacert "$root_certificate" \
    --output "$ready_body" --write-out '%{http_code}' \
    "https://localhost:${CADDY_HTTPS_PORT}/api/ready" || true)"
  [[ "$ready_status" == "200" ]] && break
  sleep 1
done
[[ "$ready_status" == "200" ]]
jq -e --arg digest "$RELEASE_DIGEST" --arg revision "$RELEASE_REVISION" '
  .status == "ready" and
  .release == {digest: $digest, revision: $revision} and
  .dependencies == {database: "available"}
' "$ready_body"

curl --silent --show-error --fail --cacert "$root_certificate" \
  "https://localhost:${CADDY_HTTPS_PORT}/api/live" \
  | jq -e '. == {status: "live"}'

docker inspect --format '{{.State.Running}}' "$neighbor_name" | grep --fixed-strings true
echo "Compose lifecycle, isolation, migration evidence, and Caddy HTTPS contracts passed"
