#!/usr/bin/env bash
set -euo pipefail

readonly CANDIDATE_IMAGE="${1:?Pass the already-built candidate image}"
readonly PREVIOUS_RELEASE="ab16f2e17db679d1c6699aa3b4a32da1da437ca7"
readonly POSTGRES_IMAGE="docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55"
readonly DB_PASSWORD="disposable-schema-forward-password"
readonly USER_ID="schema-forward-user"
readonly PLAN_ID="11111111-1111-4111-8111-111111111111"

work_directory="$(mktemp -d)"
previous_source="${work_directory}/previous-source"
suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
network="uwplan-schema-${suffix}"
database_container="uwplan-schema-db-${suffix}"
probe_container="uwplan-schema-probe-${suffix}"
previous_image="uwplan-previous-${suffix}"
previous_probe_image="uwplan-previous-probe-${suffix}"
candidate_fixture_image="uwplan-candidate-schema-${suffix}"
migration_log="${work_directory}/migration.log"

cleanup() {
  docker rm --force "$probe_container" "$database_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm --force "$previous_probe_image" "$previous_image" "$candidate_fixture_image" >/dev/null 2>&1 || true
  git worktree remove --force "$previous_source" >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}
trap cleanup EXIT

docker info >/dev/null
git cat-file -e "${PREVIOUS_RELEASE}^{commit}"
git worktree add --detach "$previous_source" "$PREVIOUS_RELEASE" >/dev/null
previous_epoch="$(git show -s --format=%ct "$PREVIOUS_RELEASE")"

docker build --quiet \
  --build-arg "RELEASE_REVISION=$PREVIOUS_RELEASE" \
  --build-arg "SOURCE_DATE_EPOCH=$previous_epoch" \
  --tag "$previous_image" \
  "$previous_source" >/dev/null
docker build --quiet \
  --file tests/fixtures/deploy/docker/PreviousProbe.Dockerfile \
  --build-arg "PREVIOUS_IMAGE=$previous_image" \
  --tag "$previous_probe_image" \
  tests/fixtures/deploy >/dev/null
docker build --quiet \
  --file tests/fixtures/deploy/docker/Candidate.Dockerfile \
  --build-arg "CANDIDATE_IMAGE=$CANDIDATE_IMAGE" \
  --tag "$candidate_fixture_image" \
  tests/fixtures/deploy >/dev/null

docker network create "$network" >/dev/null
docker run --detach --name "$database_container" --network "$network" \
  --env POSTGRES_DB=uwplan \
  --env POSTGRES_USER=uwplan_app \
  --env "POSTGRES_PASSWORD=$DB_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

for _ in {1..30}; do
  if docker exec "$database_container" pg_isready --username uwplan_app --dbname uwplan >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$database_container" pg_isready --username uwplan_app --dbname uwplan >/dev/null

database_url="postgresql://uwplan_app:${DB_PASSWORD}@${database_container}:5432/uwplan"
docker run --rm --network "$network" \
  --env "DATABASE_URL=$database_url" \
  --env RELEASE_DIGEST="sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" \
  --env RELEASE_REVISION="schema-forward-candidate" \
  "$candidate_fixture_image" \
  node /app/ops/deploy/migrate-release.mjs >"$migration_log" 2>&1
grep --fixed-strings '"event":"database.migration.compatibility"' "$migration_log"
grep --fixed-strings '"status":"accepted"' "$migration_log"
grep --fixed-strings '"contract":"expand-only"' "$migration_log"
grep --fixed-strings '"event":"database.migration"' "$migration_log"
grep --fixed-strings '"status":"success"' "$migration_log"
if grep --fixed-strings --quiet "$DB_PASSWORD" "$migration_log"; then
  echo "Migration fixture leaked its disposable credential" >&2
  exit 1
fi

docker exec "$database_container" psql --username uwplan_app --dbname uwplan \
  --set ON_ERROR_STOP=1 \
  --command "insert into \"user\" (id, email) values ('$USER_ID', 'schema-forward@example.invalid'); insert into plan (id, user_id) values ('$PLAN_ID', '$USER_ID');" >/dev/null

docker run --detach --name "$probe_container" --network "$network" \
  --publish 127.0.0.1::5000 \
  --env "DATABASE_URL=$database_url" \
  --env "EXPECTED_PLAN_ID=$PLAN_ID" \
  --env "EXPECTED_USER_ID=$USER_ID" \
  "$previous_probe_image" >/dev/null
probe_port="$(docker port "$probe_container" 5000/tcp | awk -F: '{print $NF}')"
probe_body="${work_directory}/probe.json"
probe_status=""
for _ in {1..30}; do
  probe_status="$(curl --silent --show-error --output "$probe_body" --write-out '%{http_code}' "http://127.0.0.1:${probe_port}/api/previous-schema-probe" || true)"
  [[ "$probe_status" == "200" ]] && break
  sleep 1
done
[[ "$probe_status" == "200" ]]
jq -e --arg plan "$PLAN_ID" --arg user "$USER_ID" '
  . == {status: "previous-runtime-compatible", plan: {id: $plan, userId: $user}}
' "$probe_body"

# Prove the old-runtime probe is sensitive to the field protected by this test.
docker exec "$database_container" psql --username uwplan_app --dbname uwplan \
  --set ON_ERROR_STOP=1 \
  --command 'alter table plan rename column user_id to incompatible_user_id;' >/dev/null
probe_status="$(curl --silent --show-error --output "$probe_body" --write-out '%{http_code}' "http://127.0.0.1:${probe_port}/api/previous-schema-probe")"
[[ "$probe_status" == "503" ]]
jq -e '. == {status: "previous-runtime-incompatible"}' "$probe_body"

echo "Candidate expand migration preserved the previous release's plan query"
