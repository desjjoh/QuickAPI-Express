#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
declare -a sources=(
  "$ROOT_DIR/Dockerfile"
  "$ROOT_DIR/.github/compose.ci-smoke.yml"
)

while IFS= read -r -d '' compose_file; do
  sources+=("$compose_file")
done < <(find "$ROOT_DIR" -type f \
  \( -iname 'docker-compose.test.yml' -o -iname 'docker-compose.test.yaml' \
     -o -iname 'compose.test.yml' -o -iname 'compose.test.yaml' \) -print0)

mapfile -t images < <(
  grep -Eoh '([[:alnum:]_.-]+(:[[:digit:]]+)?/)*[[:alnum:]_./-]+:[^[:space:]@]+@sha256:[[:xdigit:]]{64}' \
    "${sources[@]}" | sort -u
)

if ((${#images[@]} == 0)); then
  echo 'No digest-pinned container images found.'
  exit 0
fi

printf 'Validating %d digest-pinned container image(s):\n' "${#images[@]}"
for image in "${images[@]}"; do
  printf '  docker pull %s\n' "$image"
  docker pull "$image"
done