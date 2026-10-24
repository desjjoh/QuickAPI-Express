#!/usr/bin/env bash
set -Eeuo pipefail

# This script is the single entry point used by both CI and
# `npm run smoke:production`. Keep orchestration here rather than embedding it
# in the workflow so developers exercise the same production topology locally.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/.github/compose.ci-smoke.yml"
COMMIT="${GITHUB_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
COMMIT="$(printf '%s' "$COMMIT" | tr -cd '[:alnum:]' | cut -c1-12)"
BUILD_IMAGE=true
if [[ -n "${SMOKE_IMAGE:-}" ]]; then
  [[ "$SMOKE_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'SMOKE_IMAGE must be an immutable image ID.' >&2; exit 2; }
  BUILD_IMAGE=false
else
  export SMOKE_IMAGE="quickapi-express:ci-${COMMIT}"
fi
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
  shift 3
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if "$@"; then return 0; fi
    sleep "$delay"
  done
  echo "Timed out waiting for ${description} after ${attempts} attempts" >&2
  return 1
}

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

if [[ "$BUILD_IMAGE" == true ]]; then
  echo "Building production image once as ${SMOKE_IMAGE}"
  docker build --tag "$SMOKE_IMAGE" "$ROOT_DIR"
fi
export SMOKE_IMAGE="$(docker image inspect --format='{{.Id}}' "$SMOKE_IMAGE")"
[[ "$SMOKE_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
mkdir -p "$ROOT_DIR/.release-check"
node -e "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({imageId:process.argv[2]}, null, 2)+'\\n')" \
  "$ROOT_DIR/.release-check/smoke-image.json" "$SMOKE_IMAGE"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'image=%s\n' "$SMOKE_IMAGE" >> "$GITHUB_OUTPUT"; fi

# Exercise the actual binary/libraries and prevent bundled build tooling returning.
docker run --rm --entrypoint node "$SMOKE_IMAGE" -e \
  "if (process.versions.node.split('.')[0] !== '24' || process.getuid() === 0) throw Error('Unexpected Node runtime/user'); console.log('Minimal runtime verified: Node '+process.versions.node+', uid '+process.getuid());"
docker run --rm --user 0 --entrypoint node "$SMOKE_IMAGE" -e \
  "const fs=require('node:fs'); for (const file of ['/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/corepack','/usr/local/bin/yarn','/usr/local/bin/yarnpkg','/usr/local/lib/node_modules/npm','/usr/local/lib/node_modules/corepack','/opt/yarn','/root/.cache/node/corepack']) { try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; } throw Error('Build tooling shipped in runtime: '+file); }"

compose up --detach mysql
retry 45 2 'MySQL readiness' bash -c \
  '[[ "$(docker inspect --format={{.State.Health.Status}} "$1" 2>/dev/null)" == healthy ]]' _ \
  "$(compose ps --quiet mysql)"

echo 'Applying database migrations as a one-shot deployment step'
compose up --no-deps --abort-on-container-exit --exit-code-from migrate migrate

compose up --detach --no-deps api
retry 45 1 'API readiness' curl --fail --silent --output "$TMP_DIR/readiness" \
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
grep -Eiq '^x-content-type-options: nosniff' "$TMP_DIR/headers"
grep -Eiq "^content-security-policy: .*default-src 'self'" "$TMP_DIR/headers"
! grep -Eiq '^x-powered-by:' "$TMP_DIR/headers"

# Verify the asset served by the production image, not merely the build context.
status="$(request GET /favicon.ico "$TMP_DIR/favicon.ico" "$TMP_DIR/headers")"
[[ "$status" == 200 ]]
grep -Eiq '^content-type: image/(x-icon|vnd.microsoft.icon)(;|[[:space:]]|$)' "$TMP_DIR/headers"
node -e "const fs=require('node:fs'); const expected=fs.readFileSync(process.argv[1]); const actual=fs.readFileSync(process.argv[2]); if (!expected.length || !expected.equals(actual)) { console.error('Production favicon differs from public/favicon.ico'); process.exit(1) }" \
  "$ROOT_DIR/public/favicon.ico" "$TMP_DIR/favicon.ico"

# Principal create, read, update, list, and delete flow.
status="$(request POST /api/v1/items "$TMP_DIR/body" "$TMP_DIR/headers" \
  --header 'Content-Type: application/json' \
  --data '{"name":"Production smoke item","price":19.95,"description":"container flow"}')"
[[ "$status" == 201 ]]
json_assert "$TMP_DIR/body" "typeof body.id === 'string' && body.id.length === 16 && body.name === 'Production smoke item'"
ITEM_ID="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).id" "$TMP_DIR/body")"

status="$(request GET "/api/v1/items/${ITEM_ID}" "$TMP_DIR/body" "$TMP_DIR/headers")"
[[ "$status" == 200 ]]
json_assert "$TMP_DIR/body" "body.id === '${ITEM_ID}' && body.price === 19.95"
status="$(request PATCH "/api/v1/items/${ITEM_ID}" "$TMP_DIR/body" "$TMP_DIR/headers" \
  --header 'Content-Type: application/json' --data '{"price":24.5}')"
[[ "$status" == 200 ]]
json_assert "$TMP_DIR/body" 'body.price === 24.5'
status="$(request GET '/api/v1/items?page=1&limit=10' "$TMP_DIR/body" "$TMP_DIR/headers")"
[[ "$status" == 200 ]]
json_assert "$TMP_DIR/body" "body.total === 1 && body.data.some(item => item.id === '${ITEM_ID}')"
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
  '! curl --fail --silent --max-time 1 --output "$2" "$1/ready"' _ \
  "http://127.0.0.1:${SMOKE_PORT}" "$TMP_DIR/shutdown-ready"
retry 20 0.25 'HTTP listener to drain' bash -c \
  '! curl --silent --max-time 1 --output "$2" "$1/health"' _ \
  "http://127.0.0.1:${SMOKE_PORT}" "$TMP_DIR/shutdown-health"
retry 40 0.25 'API container exit' bash -c \
  '[[ "$(docker inspect --format={{.State.Running}} "$1")" == false ]]' _ "$API_ID"
[[ "$(docker inspect --format='{{.State.ExitCode}}' "$API_ID")" == 0 ]]

echo 'Production container smoke test passed.'
