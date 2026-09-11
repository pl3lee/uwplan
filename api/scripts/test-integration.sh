#!/usr/bin/env bash
set -euo pipefail
# Always own the server used by integration tests; ignore application credentials.
container="uwplan-api-test-$(openssl rand -hex 8)"
password="$(openssl rand -hex 16)"
cleanup() { docker rm --force "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --rm --name "$container" --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD="$password" --env POSTGRES_DB=uwplan_api_test \
  postgres:16.14-bookworm >/dev/null
export TEST_POSTGRES_HOST=127.0.0.1
export TEST_POSTGRES_PORT
TEST_POSTGRES_PORT="$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')"
export TEST_POSTGRES_USER=postgres
export TEST_POSTGRES_PASSWORD="$password"
for attempt in {1..60}; do
  # The image uses a temporary socket-only server during initialization. Wait
  # for the final TCP listener that the integration clients actually use.
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d uwplan_api_test >/dev/null; then break; fi
  sleep 0.5
done
if ! docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d uwplan_api_test >/dev/null; then
  echo "Integration PostgreSQL did not become ready on TCP" >&2
  exit 1
fi
"${GO:-go}" test -tags=integration ./...
