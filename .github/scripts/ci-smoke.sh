#!/usr/bin/env bash
set -Eeuo pipefail

# This script is the single entry point used by both CI and
# `npm run smoke:production`. Keep orchestration here rather than embedding it
# in the workflow so developers exercise the same production topology locally.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/.github/compose.ci-smoke.yml"
COMMIT="${GITHUB_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
COMMIT="$(printf '%s' "$COMMIT" | tr -cd '[:alnum:]' | cut -c1-12)"
export SMOKE_IMAGE="quickapi-express:ci-${COMMIT}"
export SMOKE_PORT="${SMOKE_PORT:-33000}"
export COMPOSE_PROJECT_NAME="quickapi-smoke-${COMMIT,,}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Production smoke test requires '$1'." >&2
    exit 127
  fi
}

require_command docker
require_command curl
require_command node
docker compose version >/dev/null

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

dump_logs() {
  echo '----- API logs -----' >&2
  compose logs --no-color api >&2 || true
  echo '----- migration logs -----' >&2
  compose logs --no-color migrate >&2 || true
  echo '----- MySQL logs -----' >&2
  compose logs --no-color mysql >&2 || true
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if ((status != 0)); then dump_logs; fi
  compose down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR:-}"
  exit "$status"
}
trap cleanup EXIT INT TERM

retry() {
  local attempts=$1 delay=$2 description=$3
@@ -45,50 +61,53 @@ retry() {

json_assert() {
  local file=$1 expression=$2
  node -e "const fs=require('fs'); const body=JSON.parse(fs.readFileSync(process.argv[1])); if (!(${expression})) { console.error('JSON assertion failed:', process.argv[2], body); process.exit(1) }" "$file" "$expression"
}

request() {
  local method=$1 path=$2 body_file=$3 header_file=$4
  shift 4
  curl --silent --show-error --output "$body_file" --dump-header "$header_file" \
    --write-out '%{http_code}' --request "$method" "http://127.0.0.1:${SMOKE_PORT}${path}" "$@"
}

expect_error() {
  local expected=$1 method=$2 path=$3
  shift 3
  local status
  status="$(request "$method" "$path" "$TMP_DIR/body" "$TMP_DIR/headers" "$@")"
  [[ "$status" == "$expected" ]]
  grep -Eiq '^content-type: application/json' "$TMP_DIR/headers"
  json_assert "$TMP_DIR/body" "body.status === ${expected} && typeof body.message === 'string' && typeof body.timestamp === 'number'"
}

TMP_DIR="$(mktemp -d)"

# Fail before building anything if the isolated topology is not valid.
compose config --quiet

echo "Building production image once as ${SMOKE_IMAGE}"
docker build --tag "$SMOKE_IMAGE" "$ROOT_DIR"

compose up --detach mysql
retry 45 2 'MySQL readiness' bash -c \
  '[[ "$(docker inspect --format={{.State.Health.Status}} "$1" 2>/dev/null)" == healthy ]]' _ \
  "$(compose ps --quiet mysql)"

echo 'Applying database migrations as a one-shot deployment step'
compose up --no-deps --abort-on-container-exit --exit-code-from migrate migrate

compose up --detach --no-deps api
retry 45 1 'API readiness' curl --fail --silent --output /dev/null \
  "http://127.0.0.1:${SMOKE_PORT}/ready"

# Liveness and readiness contracts.
status="$(request GET /health "$TMP_DIR/body" "$TMP_DIR/headers")"
[[ "$status" == 200 ]]
json_assert "$TMP_DIR/body" "body.alive === true && typeof body.uptime === 'number'"
status="$(request GET /ready "$TMP_DIR/body" "$TMP_DIR/headers")"
[[ "$status" == 200 ]]
json_assert "$TMP_DIR/body" 'body.ready === true'

# Security headers and the absence of Express implementation disclosure.
grep -Eiq '^x-frame-options: DENY' "$TMP_DIR/headers"
@@ -117,26 +136,26 @@ json_assert "$TMP_DIR/body" "body.total === 1 && body.data.some(item => item.id
status="$(request DELETE "/api/v1/items/${ITEM_ID}" "$TMP_DIR/body" "$TMP_DIR/headers")"
[[ "$status" == 200 ]]
json_assert "$TMP_DIR/body" "body.id === '${ITEM_ID}'"

# Invalid input, content-type policy, unknown routes, and common error envelope.
expect_error 422 POST /api/v1/items --header 'Content-Type: application/json' \
  --data '{"name":"","price":-1}'
expect_error 415 POST /api/v1/items --header 'Content-Type: text/plain' --data 'not json'
expect_error 415 POST /api/v1/items --data '{}'
expect_error 404 GET /this-route-does-not-exist

# Graceful termination: readiness must stop succeeding, the listener must drain,
# and the container must exit cleanly within a fixed deadline.
API_ID="$(compose ps --quiet api)"
docker kill --signal SIGTERM "$API_ID" >/dev/null
retry 20 0.25 'readiness to drop' bash -c \
  '! curl --fail --silent --max-time 1 --output /dev/null "$1/ready"' _ \
  "http://127.0.0.1:${SMOKE_PORT}"
retry 20 0.25 'HTTP listener to drain' bash -c \
  '! curl --silent --max-time 1 --output /dev/null "$1/health"' _ \
  "http://127.0.0.1:${SMOKE_PORT}"
retry 40 0.25 'API container exit' bash -c \
  '[[ "$(docker inspect --format={{.State.Running}} "$1")" == false ]]' _ "$API_ID"
[[ "$(docker inspect --format='{{.State.ExitCode}}' "$API_ID")" == 0 ]]

echo 'Production container smoke test passed.'