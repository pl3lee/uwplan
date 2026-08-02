#!/usr/bin/env bash
set -euo pipefail

readonly CANDIDATE_IMAGE="${1:?Pass the already-built UWPlan image}"
readonly POSTGRES_IMAGE="docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55"
readonly RUN_ID="20260802T193000000Z"
readonly SOURCE_PASSWORD="disposable-source-admin-password"
readonly APP_PASSWORD="disposable-candidate-app-password"
readonly ADMIN_PASSWORD="disposable-target-admin-password"
readonly PROJECT_NAME="${COMPOSE_PROJECT_NAME:-uwplan-db-candidate-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}}"
readonly NETWORK="${PROJECT_NAME}_runtime"
readonly SOURCE_CONTAINER="${PROJECT_NAME}-source"

work_directory="$(mktemp -d)"
source_state="${work_directory}/source-state"
target_state="${work_directory}/target-state"
source_environment="${work_directory}/source.env"
target_environment="${work_directory}/target.env"
runtime_environment="${work_directory}/runtime.env"
release_environment="${work_directory}/release.env"
app_environment="${work_directory}/app.env"
alloy_environment="${work_directory}/alloy.env"
app_password_file="${work_directory}/app-password"
admin_password_file="${work_directory}/admin-password"
capture_evidence="${work_directory}/capture.json"
restore_evidence="${work_directory}/restore.json"
readiness_evidence="${work_directory}/readiness.json"

compose() {
  COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
  UWPLAN_IMAGE="$CANDIDATE_IMAGE" \
  UWPLAN_ENV_FILE="$app_environment" \
  UWPLAN_ALLOY_ENV_FILE="$alloy_environment" \
  POSTGRES_PASSWORD_FILE="$app_password_file" \
  POSTGRES_ADMIN_PASSWORD_FILE="$admin_password_file" \
  RELEASE_DIGEST="sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" \
  RELEASE_REVISION="database-candidate-fixture" \
    docker compose --project-name "$PROJECT_NAME" --file compose.yaml "$@"
}

source_host() {
  NODE_ENV=test \
  UWPLAN_DB_STATE_ROOT="$source_state" \
  UWPLAN_DB_SOURCE_ENV="$source_environment" \
    node ops/database/host-command.mjs "$@"
}

target_host() {
  NODE_ENV=test \
  COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
  UWPLAN_DB_STATE_ROOT="$target_state" \
  UWPLAN_DB_TARGET_ENV="$target_environment" \
  UWPLAN_DB_RUNTIME_ENV="$runtime_environment" \
  UWPLAN_DB_RELEASE_ENV="$release_environment" \
  UWPLAN_DB_COMPOSE_FILE="$(pwd)/compose.yaml" \
    node ops/database/host-command.mjs "$@"
}

cleanup() {
  docker rm --force "$SOURCE_CONTAINER" >/dev/null 2>&1 || true
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}
trap cleanup EXIT

chmod 700 "$work_directory"
mkdir -m 700 "$source_state" "$target_state"
printf '%s' "$APP_PASSWORD" >"$app_password_file"
printf '%s' "$ADMIN_PASSWORD" >"$admin_password_file"
chmod 600 "$app_password_file" "$admin_password_file"

cat >"$app_environment" <<EOF
AUTH_GITHUB_ID=candidate-github-id
AUTH_GITHUB_SECRET=candidate-github-secret
AUTH_GOOGLE_ID=candidate-google-id
AUTH_GOOGLE_SECRET=candidate-google-secret
AUTH_SECRET=candidate-auth-secret
AUTH_TRUST_HOST=true
DATABASE_URL=postgresql://uwplan_app:${APP_PASSWORD}@db:5432/uwplan
EOF
cat >"$alloy_environment" <<EOF
UWPLAN_REMOTE_OTLP_ENDPOINT=127.0.0.1:4317
UWPLAN_REMOTE_OTLP_TOKEN=disposable-otlp-token
UWPLAN_REMOTE_LOKI_URL=http://127.0.0.1:9/loki/api/v1/push
UWPLAN_REMOTE_LOKI_TOKEN=disposable-loki-token
UWPLAN_REMOTE_PROMETHEUS_URL=http://127.0.0.1:9/api/v1/push
UWPLAN_REMOTE_PROMETHEUS_TOKEN=disposable-prometheus-token
UWPLAN_EXTERNAL_READINESS_URL=https://example.invalid/api/ready
EOF
chmod 600 "$app_environment" "$alloy_environment"

cat >"$runtime_environment" <<EOF
UWPLAN_ENV_FILE=${app_environment}
UWPLAN_ALLOY_ENV_FILE=${alloy_environment}
POSTGRES_PASSWORD_FILE=${app_password_file}
POSTGRES_ADMIN_PASSWORD_FILE=${admin_password_file}
EOF
cat >"$release_environment" <<EOF
UWPLAN_IMAGE=${CANDIDATE_IMAGE}
RELEASE_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
RELEASE_REVISION=database-candidate-fixture
EOF
chmod 600 "$runtime_environment" "$release_environment"

compose up --detach --wait db
docker run --detach --name "$SOURCE_CONTAINER" --network "$NETWORK" \
  --env POSTGRES_DB=uwplan_fixture \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=$SOURCE_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null
for _ in {1..30}; do
  docker exec "$SOURCE_CONTAINER" pg_isready --username postgres --dbname uwplan_fixture >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$SOURCE_CONTAINER" pg_isready --username postgres --dbname uwplan_fixture >/dev/null

docker run --rm --network "$NETWORK" \
  --env "DATABASE_URL=postgresql://postgres:${SOURCE_PASSWORD}@${SOURCE_CONTAINER}:5432/uwplan_fixture" \
  --env RELEASE_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  --env RELEASE_REVISION=database-candidate-fixture \
  "$CANDIDATE_IMAGE" node /app/ops/deploy/migrate-release.mjs >/dev/null
docker exec "$SOURCE_CONTAINER" psql --username postgres --dbname uwplan_fixture \
  --set ON_ERROR_STOP=1 --command \
  "insert into \"user\" (id, email) values ('candidate-fixture-user', 'candidate@example.invalid');" >/dev/null

cat >"$source_environment" <<EOF
PGHOST=${SOURCE_CONTAINER}
PGPORT=5432
PGUSER=postgres
PGPASSWORD=${SOURCE_PASSWORD}
PGDATABASE=uwplan_fixture
UWPLAN_DB_DOCKER_NETWORK=${NETWORK}
EOF
cat >"$target_environment" <<EOF
PGHOST=db
PGPORT=5432
PGUSER=postgres
PGPASSWORD=${ADMIN_PASSWORD}
PGDATABASE=postgres
UWPLAN_DB_DOCKER_NETWORK=${NETWORK}
EOF
chmod 600 "$source_environment" "$target_environment"

source_host capture "$RUN_ID" >"$capture_evidence"
source_host stream-manifest "$RUN_ID" | target_host receive-manifest "$RUN_ID" >/dev/null
archive_sha256="$(jq --raw-output '.archive.sha256' "$capture_evidence")"
source_host stream-archive "$RUN_ID" \
  | target_host receive-archive "$RUN_ID" "$archive_sha256" >/dev/null
target_host restore "$RUN_ID" >"$restore_evidence"

candidate_database="$(jq --raw-output '.candidateDatabase' "$restore_evidence")"
[[ "$candidate_database" == "uwplan_candidate_${RUN_ID}" ]]
docker run --rm --network "$NETWORK" \
  --env "PGPASSWORD=$APP_PASSWORD" \
  "$POSTGRES_IMAGE" psql --host db --username uwplan_app --dbname "$candidate_database" \
  --tuples-only --no-align --command \
  "select email from \"user\" where id = 'candidate-fixture-user'" \
  | grep --fixed-strings candidate@example.invalid

if docker run --rm --network "$NETWORK" \
  --env "PGPASSWORD=$APP_PASSWORD" \
  "$POSTGRES_IMAGE" psql --host db --username postgres --dbname postgres \
  --command 'select 1' >/dev/null 2>&1; then
  echo "The application credential unexpectedly authenticated as postgres" >&2
  exit 1
fi

target_host boot-candidate "$RUN_ID" "$candidate_database" >"$readiness_evidence"
jq -e --arg candidate "$candidate_database" '
  .applicationBooted == true and
  .readiness == "ready" and
  .databaseDependency == "available" and
  .applicationRole == "uwplan_app" and
  .candidateDatabase == $candidate
' "$readiness_evidence" >/dev/null

if grep --fixed-strings --quiet "$SOURCE_PASSWORD" \
  "$capture_evidence" "$restore_evidence" "$readiness_evidence"; then
  echo "Database candidate evidence leaked the source credential" >&2
  exit 1
fi
if grep --fixed-strings --quiet "$APP_PASSWORD" \
  "$capture_evidence" "$restore_evidence" "$readiness_evidence"; then
  echo "Database candidate evidence leaked the app credential" >&2
  exit 1
fi

echo "Snapshot capture, SSH-shaped transfer, fresh restore, role isolation, and candidate readiness passed"
