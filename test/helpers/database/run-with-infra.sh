#!/usr/bin/env bash
set -Eeuo pipefail

project="${1:?Test project name is required}"
shift

case "$project" in
  integration|e2e|migration) ;;
  *) echo "Unsupported test project: $project" >&2; exit 2 ;;
esac

# Reject unsafe targets before installing any destructive cleanup handler.
npm run test:db:safety

# Install the cleanup handler before startup so partial startup failures are disposable too.
cleanup() {
  local status=$? cleanup_status=0
  trap - EXIT INT TERM
  npm run test:infra:down || cleanup_status=$?
  if ((status != 0)); then exit "$status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

npm run test:infra:up
npm run test:infra:prepare
npm run "test:${project}:run" -- "$@"
