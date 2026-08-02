#!/usr/bin/env bash
set -euo pipefail

readonly CADDY_IMAGE="docker.io/library/caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
readonly NODE_IMAGE="docker.io/library/node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3"
readonly CADDY_NAME="uwplan-rehearsal-caddy-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
readonly BACKEND_NAME="${CADDY_NAME}-backend"
readonly NETWORK_NAME="${CADDY_NAME}-network"
readonly SITE_PORT="${UWPLAN_REHEARSAL_TEST_PORT:-19453}"
readonly BACKEND_PORT="${UWPLAN_REHEARSAL_BACKEND_TEST_PORT:-19091}"
readonly BASIC_USER="named-tester"
readonly BASIC_PASSWORD="disposable-basic-password-for-rehearsal"

work_directory="$(mktemp -d)"
root_certificate="${work_directory}/caddy-root.crt"

cleanup() {
  docker rm --volumes --force "$CADDY_NAME" "$BACKEND_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}
trap cleanup EXIT

docker info >/dev/null
docker pull "$CADDY_IMAGE" >/dev/null
docker pull "$NODE_IMAGE" >/dev/null
password_hash="$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$BASIC_PASSWORD")"

docker network create "$NETWORK_NAME" >/dev/null
docker run --detach --name "$BACKEND_NAME" --network "$NETWORK_NAME" \
  --env "UWPLAN_FAKE_BACKEND_PORT=${BACKEND_PORT}" \
  --volume "$(pwd)/tests/fixtures/auth-rehearsal/fake-backend.mjs:/fake-backend.mjs:ro" \
  "$NODE_IMAGE" node /fake-backend.mjs >/dev/null

for _ in {1..30}; do
  docker exec "$BACKEND_NAME" node -e \
    "fetch('http://127.0.0.1:${BACKEND_PORT}/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1 && break
  sleep 0.1
done
docker inspect --format '{{.State.Running}}' "$BACKEND_NAME" | grep --fixed-strings true

docker run --detach --name "$CADDY_NAME" --network "$NETWORK_NAME" \
  --publish "127.0.0.1:${SITE_PORT}:${SITE_PORT}" \
  --env "UWPLAN_REHEARSAL_SITE=https://localhost:${SITE_PORT}" \
  --env "UWPLAN_REHEARSAL_BACKEND=${BACKEND_NAME}:${BACKEND_PORT}" \
  --env "UWPLAN_REHEARSAL_BASIC_USER=${BASIC_USER}" \
  --env "UWPLAN_REHEARSAL_BASIC_PASSWORD_HASH=${password_hash}" \
  --env "UWPLAN_REHEARSAL_TLS_DIRECTIVE=tls internal" \
  --volume "$(pwd)/ops/caddy/rehearsal.Caddyfile:/etc/caddy/Caddyfile:ro" \
  --volume /data \
  "$CADDY_IMAGE" >/dev/null

for _ in {1..30}; do
  docker exec "$CADDY_NAME" test -f /data/caddy/pki/authorities/local/root.crt \
    >/dev/null 2>&1 && break
  sleep 1
done
docker cp "$CADDY_NAME:/data/caddy/pki/authorities/local/root.crt" \
  "$root_certificate" >/dev/null

for _ in {1..30}; do
  curl --silent --fail --cacert "$root_certificate" \
    "https://localhost:${SITE_PORT}/api/ready" >/dev/null 2>&1 && break
  sleep 0.2
done

curl --silent --fail --cacert "$root_certificate" \
  "https://localhost:${SITE_PORT}/api/ready" >/dev/null

request() {
  curl --silent --show-error --cacert "$root_certificate" "$@"
}

ready_body="$(request "https://localhost:${SITE_PORT}/api/ready")"
jq -e '.appMarker == "isolated-rehearsal-backend" and .authorization == "absent"' \
  <<<"$ready_body" >/dev/null

for path in /signin /api/auth/callback/google /api/auth/callback/github; do
  body="${work_directory}/unauthorized.json"
  status="$(request --output "$body" --write-out '%{http_code}' \
    "https://localhost:${SITE_PORT}${path}")"
  [[ "$status" == "401" ]]
  ! grep --fixed-strings --quiet isolated-rehearsal-backend "$body"
done

wrong_status="$(request --user "${BASIC_USER}:wrong-password" --output /dev/null \
  --write-out '%{http_code}' "https://localhost:${SITE_PORT}/signin")"
[[ "$wrong_status" == "401" ]]

for path in /signin /api/auth/callback/google /api/auth/callback/github /api/rehearsal/request-boundary; do
  protected_body="$(request --user "${BASIC_USER}:${BASIC_PASSWORD}" \
    "https://localhost:${SITE_PORT}${path}")"
  jq -e '.appMarker == "isolated-rehearsal-backend" and .authorization == "absent"' \
    <<<"$protected_body" >/dev/null
done

echo "Rehearsal Caddy Basic Auth, callback coverage, and header stripping passed"
