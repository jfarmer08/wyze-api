#!/usr/bin/env bash
# Build + run the Tutk loader smoke test in Docker.
#
# Usage:
#   ./tests/docker/run-tutk-smoke.sh                  # build + run for host arch
#   ./tests/docker/run-tutk-smoke.sh amd64            # force linux/amd64 (Rosetta on Apple Silicon)
#   ./tests/docker/run-tutk-smoke.sh arm64            # force linux/arm64
#   ./tests/docker/run-tutk-smoke.sh both             # run both archs sequentially
#
# Run from the wyze-api repo root.

set -euo pipefail

if [ ! -f "tests/docker/Dockerfile.tutk-smoke" ]; then
  echo "error: run this from the wyze-api repo root" >&2
  exit 1
fi

TARGET="${1:-host}"
TAG_BASE="wyze-api-tutk-smoke"

build_and_run() {
  local platform="$1"
  local tag="$2"
  local plat_flag=""
  if [ -n "$platform" ]; then
    plat_flag="--platform $platform"
  fi
  echo
  echo "==============================================================="
  echo "  Tutk smoke — platform=${platform:-host} tag=${tag}"
  echo "==============================================================="
  echo
  echo "→ docker build $plat_flag -f tests/docker/Dockerfile.tutk-smoke -t $tag ."
  docker build $plat_flag -f tests/docker/Dockerfile.tutk-smoke -t "$tag" . >/dev/null
  echo
  echo "→ docker run --rm $plat_flag $tag"
  echo
  docker run --rm $plat_flag "$tag"
}

case "$TARGET" in
  host)
    build_and_run "" "$TAG_BASE"
    ;;
  amd64|x86_64|x64)
    build_and_run "linux/amd64" "${TAG_BASE}-amd64"
    ;;
  arm64|aarch64)
    build_and_run "linux/arm64" "${TAG_BASE}-arm64"
    ;;
  both)
    build_and_run "linux/amd64" "${TAG_BASE}-amd64"
    build_and_run "linux/arm64" "${TAG_BASE}-arm64"
    ;;
  *)
    echo "error: unknown target '$TARGET' (try: host, amd64, arm64, both)" >&2
    exit 2
    ;;
esac
