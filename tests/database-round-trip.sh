#!/usr/bin/env bash
set -euo pipefail

readonly CANDIDATE_IMAGE="${1:?Pass the already-built UWPlan image}"
readonly POSTGRES_IMAGE="docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55"
readonly FORWARD_RUN_ID="20260802T203000000Z"
readonly REJECTED_REVERSE_RUN_ID="20260802T203500000Z"
readonly REVERSE_RUN_ID="20260802T204000000Z"
readonly RACKNerd_PASSWORD="disposable-racknerd-admin-password"
readonly DO_ADMIN_PASSWORD="disposable-digitalocean-admin-password"
readonly APP_PASSWORD="disposable-round-trip-app-password"
readonly PROJECT_NAME="${COMPOSE_PROJECT_NAME:-uwplan-db-round-trip-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}}"
readonly NETWORK="${PROJECT_NAME}_runtime"
readonly RACKNerd_CONTAINER="${PROJECT_NAME}-racknerd"

work_directory="$(mktemp -d)"
racknerd_state="${work_directory}/racknerd-state"
digitalocean_state="${work_directory}/digitalocean-state"
racknerd_source_environment="${work_directory}/racknerd-source.env"
racknerd_target_environment="${work_directory}/racknerd-target.env"
digitalocean_target_environment="${work_directory}/digitalocean-target.env"
racknerd_runtime_environment="${work_directory}/racknerd-runtime.env"
digitalocean_runtime_environment="${work_directory}/digitalocean-runtime.env"
release_environment="${work_directory}/release.env"
racknerd_app_environment="${work_directory}/racknerd-app.env"
digitalocean_app_environment="${work_directory}/digitalocean-app.env"
alloy_environment="${work_directory}/alloy.env"
app_password_file="${work_directory}/app-password"
admin_password_file="${work_directory}/admin-password"
forward_capture="${work_directory}/forward-capture.json"
forward_restore="${work_directory}/forward-restore.json"
forward_integrity="${work_directory}/forward-integrity.json"
forward_readiness="${work_directory}/forward-readiness.json"
workflow_write="${work_directory}/workflow-write.json"
reverse_capture="${work_directory}/reverse-capture.json"
reverse_restore="${work_directory}/reverse-restore.json"
reverse_integrity="${work_directory}/reverse-integrity.json"
workflow_verify="${work_directory}/workflow-verify.json"
reverse_readiness="${work_directory}/reverse-readiness.json"

compose() {
  COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
  UWPLAN_IMAGE="$CANDIDATE_IMAGE" \
  UWPLAN_ENV_FILE="$digitalocean_app_environment" \
  UWPLAN_ALLOY_ENV_FILE="$alloy_environment" \
  POSTGRES_PASSWORD_FILE="$app_password_file" \
  POSTGRES_ADMIN_PASSWORD_FILE="$admin_password_file" \
  RELEASE_DIGEST="sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" \
  RELEASE_REVISION="database-round-trip-fixture" \
    docker compose --project-name "$PROJECT_NAME" --file compose.yaml "$@"
}

racknerd_host() {
  NODE_ENV=test \
  COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
  UWPLAN_DB_STATE_ROOT="$racknerd_state" \
  UWPLAN_DB_SOURCE_ENV="$racknerd_source_environment" \
  UWPLAN_DB_TARGET_ENV="$racknerd_target_environment" \
  UWPLAN_DB_RUNTIME_ENV="$racknerd_runtime_environment" \
  UWPLAN_DB_RELEASE_ENV="$release_environment" \
  UWPLAN_DB_COMPOSE_FILE="$(pwd)/compose.yaml" \
    node ops/database/host-command.mjs "$@"
}

digitalocean_host() {
  NODE_ENV=test \
  COMPOSE_PROJECT_NAME="$PROJECT_NAME" \
  UWPLAN_DB_STATE_ROOT="$digitalocean_state" \
  UWPLAN_DB_TARGET_ENV="$digitalocean_target_environment" \
  UWPLAN_DB_RUNTIME_ENV="$digitalocean_runtime_environment" \
  UWPLAN_DB_RELEASE_ENV="$release_environment" \
  UWPLAN_DB_COMPOSE_FILE="$(pwd)/compose.yaml" \
    node ops/database/host-command.mjs "$@"
}

cleanup() {
  docker rm --force "$RACKNerd_CONTAINER" >/dev/null 2>&1 || true
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}

file_mode() {
  if stat -c '%a' "$1" 2>/dev/null; then
    return
  fi
  stat -f '%Lp' "$1"
}
trap cleanup EXIT

chmod 700 "$work_directory"
mkdir -m 700 "$racknerd_state" "$digitalocean_state"
printf '%s' "$APP_PASSWORD" >"$app_password_file"
printf '%s' "$DO_ADMIN_PASSWORD" >"$admin_password_file"
chmod 600 "$app_password_file" "$admin_password_file"

cat >"$digitalocean_app_environment" <<EOF
AUTH_GITHUB_ID=round-trip-github-id
AUTH_GITHUB_SECRET=round-trip-github-secret
AUTH_GOOGLE_ID=round-trip-google-id
AUTH_GOOGLE_SECRET=round-trip-google-secret
AUTH_SECRET=round-trip-auth-secret
AUTH_TRUST_HOST=true
DATABASE_URL=postgresql://uwplan_app:${APP_PASSWORD}@db:5432/uwplan
EOF
cat >"$racknerd_app_environment" <<EOF
AUTH_GITHUB_ID=round-trip-github-id
AUTH_GITHUB_SECRET=round-trip-github-secret
AUTH_GOOGLE_ID=round-trip-google-id
AUTH_GOOGLE_SECRET=round-trip-google-secret
AUTH_SECRET=round-trip-auth-secret
AUTH_TRUST_HOST=true
DATABASE_URL=postgresql://uwplan_app:${APP_PASSWORD}@${RACKNerd_CONTAINER}:5432/uwplan
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
cat >"$digitalocean_runtime_environment" <<EOF
UWPLAN_ENV_FILE=${digitalocean_app_environment}
UWPLAN_ALLOY_ENV_FILE=${alloy_environment}
POSTGRES_PASSWORD_FILE=${app_password_file}
POSTGRES_ADMIN_PASSWORD_FILE=${admin_password_file}
EOF
cat >"$racknerd_runtime_environment" <<EOF
UWPLAN_ENV_FILE=${racknerd_app_environment}
UWPLAN_ALLOY_ENV_FILE=${alloy_environment}
POSTGRES_PASSWORD_FILE=${app_password_file}
POSTGRES_ADMIN_PASSWORD_FILE=${admin_password_file}
EOF
cat >"$release_environment" <<EOF
UWPLAN_IMAGE=${CANDIDATE_IMAGE}
RELEASE_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
RELEASE_REVISION=database-round-trip-fixture
EOF
chmod 600 \
  "$digitalocean_app_environment" \
  "$racknerd_app_environment" \
  "$alloy_environment" \
  "$digitalocean_runtime_environment" \
  "$racknerd_runtime_environment" \
  "$release_environment"

compose up --detach --wait db
docker run --detach --name "$RACKNerd_CONTAINER" --network "$NETWORK" \
  --env POSTGRES_DB=uwplan_fixture \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=$RACKNerd_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null
for _ in {1..30}; do
  docker exec "$RACKNerd_CONTAINER" pg_isready --username postgres --dbname uwplan_fixture >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$RACKNerd_CONTAINER" pg_isready --username postgres --dbname uwplan_fixture >/dev/null

docker run --rm --network "$NETWORK" \
  --env "DATABASE_URL=postgresql://postgres:${RACKNerd_PASSWORD}@${RACKNerd_CONTAINER}:5432/uwplan_fixture" \
  --env RELEASE_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  --env RELEASE_REVISION=database-round-trip-fixture \
  "$CANDIDATE_IMAGE" node /app/ops/deploy/migrate-release.mjs >/dev/null
docker exec "$RACKNerd_CONTAINER" psql --username postgres --dbname postgres \
  --set ON_ERROR_STOP=1 --command \
  "create role uwplan_app login password '${APP_PASSWORD}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls;" >/dev/null
docker exec "$RACKNerd_CONTAINER" psql --username postgres --dbname uwplan_fixture \
  --set ON_ERROR_STOP=1 --command \
  "insert into \"user\" (id, email) values ('round-trip-fixture-user', 'fixture@example.invalid');" >/dev/null

cat >"$racknerd_source_environment" <<EOF
PGHOST=${RACKNerd_CONTAINER}
PGPORT=5432
PGUSER=postgres
PGPASSWORD=${RACKNerd_PASSWORD}
PGDATABASE=uwplan_fixture
UWPLAN_DB_DOCKER_NETWORK=${NETWORK}
EOF
cat >"$racknerd_target_environment" <<EOF
PGHOST=${RACKNerd_CONTAINER}
PGPORT=5432
PGUSER=postgres
PGPASSWORD=${RACKNerd_PASSWORD}
PGDATABASE=postgres
UWPLAN_DB_DOCKER_NETWORK=${NETWORK}
EOF
cat >"$digitalocean_target_environment" <<EOF
PGHOST=db
PGPORT=5432
PGUSER=postgres
PGPASSWORD=${DO_ADMIN_PASSWORD}
PGDATABASE=postgres
UWPLAN_DB_DOCKER_NETWORK=${NETWORK}
EOF
chmod 600 \
  "$racknerd_source_environment" \
  "$racknerd_target_environment" \
  "$digitalocean_target_environment"

racknerd_host capture "$FORWARD_RUN_ID" >"$forward_capture"
racknerd_host stream-manifest "$FORWARD_RUN_ID" \
  | digitalocean_host receive-manifest "$FORWARD_RUN_ID" >/dev/null
forward_sha256="$(jq --raw-output '.archive.sha256' "$forward_capture")"
racknerd_host stream-archive "$FORWARD_RUN_ID" \
  | digitalocean_host receive-archive "$FORWARD_RUN_ID" "$forward_sha256" >/dev/null
digitalocean_host restore "$FORWARD_RUN_ID" >"$forward_restore"
forward_database="$(jq --raw-output '.candidateDatabase' "$forward_restore")"
digitalocean_host validate-integrity "$FORWARD_RUN_ID" "$forward_database" >"$forward_integrity"
digitalocean_host boot-candidate "$FORWARD_RUN_ID" "$forward_database" >"$forward_readiness"
if digitalocean_host capture-candidate \
  "$REJECTED_REVERSE_RUN_ID" "$forward_database" "$FORWARD_RUN_ID" >/dev/null 2>&1; then
  echo "Reverse capture started before the UWPlan workflow write" >&2
  exit 1
fi
digitalocean_host write-candidate-workflow "$FORWARD_RUN_ID" "$forward_database" >"$workflow_write"

digitalocean_host capture-candidate \
  "$REVERSE_RUN_ID" "$forward_database" "$FORWARD_RUN_ID" >"$reverse_capture"
digitalocean_host stream-manifest "$REVERSE_RUN_ID" \
  | racknerd_host receive-manifest "$REVERSE_RUN_ID" >/dev/null
reverse_sha256="$(jq --raw-output '.archive.sha256' "$reverse_capture")"
digitalocean_host stream-archive "$REVERSE_RUN_ID" \
  | racknerd_host receive-archive "$REVERSE_RUN_ID" "$reverse_sha256" >/dev/null
racknerd_host restore "$REVERSE_RUN_ID" >"$reverse_restore"
reverse_database="$(jq --raw-output '.candidateDatabase' "$reverse_restore")"
racknerd_host validate-integrity "$REVERSE_RUN_ID" "$reverse_database" >"$reverse_integrity"
racknerd_host verify-candidate-workflow \
  "$REVERSE_RUN_ID" "$reverse_database" "$FORWARD_RUN_ID" >"$workflow_verify"
racknerd_host boot-candidate "$REVERSE_RUN_ID" "$reverse_database" >"$reverse_readiness"

jq -s -e --arg forward "$forward_database" --arg reverse "$reverse_database" '
  .[0].status == "accepted" and
  .[1].applicationBooted == true and
  .[2].status == "written" and
  .[3].source.database == $forward and
  .[4].status == "accepted" and
  .[5].status == "verified" and
  .[6].applicationBooted == true and
  $forward != $reverse
' \
  "$forward_integrity" \
  "$forward_readiness" \
  "$workflow_write" \
  "$reverse_capture" \
  "$reverse_integrity" \
  "$workflow_verify" \
  "$reverse_readiness" >/dev/null

write_proof_sha="$(jq --raw-output '.proofSha256' "$workflow_write")"
verify_proof_sha="$(jq --raw-output '.proofSha256' "$workflow_verify")"
[[ "$write_proof_sha" == "$verify_proof_sha" ]]
[[ "$(jq --raw-output '.workflowProofSha256' "$reverse_capture")" == "$write_proof_sha" ]]

source_fixture_count="$(
  docker exec "$RACKNerd_CONTAINER" psql \
    --username postgres --dbname uwplan_fixture --tuples-only --no-align \
    --command \
    "select count(*) from \"user\" where id = 'round-trip-fixture-user' and email = 'fixture@example.invalid'"
)"
source_proof_count="$(
  docker exec "$RACKNerd_CONTAINER" psql \
    --username postgres --dbname uwplan_fixture --tuples-only --no-align \
    --command "select count(*) from \"user\" where id like 'restore-proof-%'"
)"
[[ "$source_fixture_count" == "1" ]]
[[ "$source_proof_count" == "0" ]]

while IFS= read -r -d '' protected_file; do
  if [[ "$(file_mode "$protected_file")" != "600" ]]; then
    echo "Round-trip artifact was not protected: $protected_file" >&2
    exit 1
  fi
done < <(find "$racknerd_state" "$digitalocean_state" -type f -print0)

if grep --fixed-strings --quiet "$RACKNerd_PASSWORD" \
  "$forward_capture" "$forward_restore" "$forward_integrity" "$forward_readiness" \
  "$workflow_write" "$reverse_capture" "$reverse_restore" "$reverse_integrity" \
  "$workflow_verify" "$reverse_readiness"; then
  echo "Round-trip evidence leaked the RackNerd credential" >&2
  exit 1
fi
if grep --fixed-strings --quiet "$APP_PASSWORD" \
  "$forward_capture" "$forward_restore" "$forward_integrity" "$forward_readiness" \
  "$workflow_write" "$reverse_capture" "$reverse_restore" "$reverse_integrity" \
  "$workflow_verify" "$reverse_readiness"; then
  echo "Round-trip evidence leaked the application credential" >&2
  exit 1
fi
if grep --fixed-strings --quiet "$DO_ADMIN_PASSWORD" \
  "$forward_capture" "$forward_restore" "$forward_integrity" "$forward_readiness" \
  "$workflow_write" "$reverse_capture" "$reverse_restore" "$reverse_integrity" \
  "$workflow_verify" "$reverse_readiness"; then
  echo "Round-trip evidence leaked the DigitalOcean credential" >&2
  exit 1
fi
if grep --fixed-strings --quiet fixture@example.invalid \
  "$forward_capture" "$forward_restore" "$forward_integrity" "$forward_readiness" \
  "$workflow_write" "$reverse_capture" "$reverse_restore" "$reverse_integrity" \
  "$workflow_verify" "$reverse_readiness"; then
  echo "Round-trip evidence leaked a row value" >&2
  exit 1
fi

echo "Forward restore, UWPlan writes, protected reverse restore, and preserved readiness passed"
