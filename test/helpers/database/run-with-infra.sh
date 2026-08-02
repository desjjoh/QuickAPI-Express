#!/usr/bin/env bash
set -Eeuo pipefail

project="${1:?Vitest project name is required}"

# Install the cleanup handler before startup so partial startup failures are disposable too.
cleanup() {
  npm run test:infra:down
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

npm run test:infra:up
npm run test:infra:prepare
npm exec -- vitest run --project "$project"