#!/usr/bin/env bash
set -euo pipefail

# Exercise the release artifacts with disposable dependencies, never host data.
: "${UWPLAN_API_IMAGE:?Set UWPLAN_API_IMAGE to the built API image}"
: "${UWPLAN_WEB_IMAGE:?Set UWPLAN_WEB_IMAGE to the built web image}"
docker image inspect "$UWPLAN_API_IMAGE" "$UWPLAN_WEB_IMAGE" >/dev/null
docker run --rm --read-only --cap-drop ALL --entrypoint node "$UWPLAN_WEB_IMAGE" -e '
  const assert = require("node:assert/strict");
  assert.match(require("react").version, /^19\./);
  assert.ok(!require("node:fs").readdirSync("node_modules/.pnpm").some(name => name.startsWith("next@")), "web artifact must exclude the old runtime");
'
project="uwplan-images-${GITHUB_RUN_ID:-local}-$$"
work_directory="$(mktemp -d)"
owned_containers=()
network_created=false
cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    for container in ${owned_containers[@]+"${owned_containers[@]}"}; do
      docker logs --tail 40 "$container" || true
    done
  fi
  for container in ${owned_containers[@]+"${owned_containers[@]}"}; do
    docker rm -f "$container" >/dev/null || status=1
  done
  if [[ "$network_created" == true ]]; then docker network rm "$project" >/dev/null || status=1; fi
  rm -rf "$work_directory"
  return "$status"
}
trap cleanup EXIT
docker network create "$project" >/dev/null
network_created=true
start() {
  local service="$1"
  shift
  docker create --name "$project-$service" --network "$project" --network-alias "$service" "$@" >/dev/null
  owned_containers+=("$project-$service")
  docker start "$project-$service" >/dev/null
}
wait_healthy() {
  local container="$1"
  for attempt in {1..60}; do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]]; then return; fi
    sleep 1
  done
  docker logs "$container"
  return 1
}
start db --memory 160m --shm-size 32m \
  -e POSTGRES_PASSWORD=disposable-password -e POSTGRES_DB=uwplan \
  --health-cmd 'pg_isready -h 127.0.0.1 -U postgres -d uwplan' --health-interval 1s \
  postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55 \
  postgres -c shared_buffers=32MB -c max_connections=30 -c work_mem=2MB -c maintenance_work_mem=16MB
wait_healthy "$project-db"
start redis --memory 64m --health-cmd 'redis-cli ping' --health-interval 1s \
  redis:7@sha256:71da9275c5f3fcb97d0fa0c8c5b36cc995327265420f17a04bfd544f458059f7 redis-server --maxmemory 32mb --maxmemory-policy noeviction
wait_healthy "$project-redis"
database_url='postgresql://postgres:disposable-password@db:5432/uwplan?sslmode=disable'
docker run --rm --network "$project" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m -e DATABASE_URL="$database_url" --entrypoint /app/migrate "$UWPLAN_API_IMAGE"
digest="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$UWPLAN_API_IMAGE")"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$UWPLAN_WEB_IMAGE")" == "$revision" ]]
for candidate in "$UWPLAN_API_IMAGE" "$UWPLAN_WEB_IMAGE"; do
  image_user="$(docker image inspect --format '{{.Config.User}}' "$candidate")"
  [[ -n "$image_user" && "$image_user" != root && "$image_user" != 0 && "$image_user" != 0:0 ]]
done
start api --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m \
  -e DATABASE_URL="$database_url" -e REDIS_URL=redis://redis:6379/0 \
  -e PUBLIC_ORIGIN=http://localhost -e RELEASE_DIGEST="$digest" -e RELEASE_REVISION="$revision" \
  "$UWPLAN_API_IMAGE"
wait_healthy "$project-api"
start web --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m \
  -p 127.0.0.1::3000 -e API_ORIGIN=http://api:8080 \
  -e RELEASE_DIGEST="$digest" -e RELEASE_REVISION="$revision" "$UWPLAN_WEB_IMAGE"
wait_healthy "$project-web"
origin="http://$(docker port "$project-web" 3000/tcp)"
curl --fail --silent --show-error "$origin/api/ready" | \
  jq -e --arg digest "$digest" --arg revision "$revision" \
  '.status == "ready" and .release == {digest: $digest, revision: $revision}'
curl --fail --silent --show-error "$origin/signin" > "$work_directory/signin.html"
rg -q 'Sign in with Google' "$work_directory/signin.html"
rg -q 'Sign in with GitHub' "$work_directory/signin.html"
asset_path="$(python3 - "$work_directory/signin.html" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import sys
class Assets(HTMLParser):
    paths = []
    def handle_starttag(self, tag, attrs):
        href = dict(attrs).get('href', '')
        if href.startswith('/assets/') and href.endswith('.js'):
            self.paths.append(href)
parser = Assets()
parser.feed(Path(sys.argv[1]).read_text())
print(parser.paths[0])
PY
)"
curl --fail --silent --show-error "$origin$asset_path" > /dev/null
curl --fail --silent --show-error "$origin/privacy" > /dev/null
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/select")" == 302 ]]
[[ -z "$(docker port "$project-db")" && -z "$(docker port "$project-redis")" && -z "$(docker port "$project-api")" ]]
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' "$project-web" "$project-api" "$project-db" "$project-redis"
echo 'Separate API/web images, migration, readiness, public routes, isolation and memory limits passed'
