#!/usr/bin/env bash
# Build + run the real-camera smoke test in Docker.
#
# Usage (from wyze-api repo root):
#
#   # First time — fill in credentials in .env (file is gitignored):
#   cp tests/docker/.env.sample tests/docker/.env
#   $EDITOR tests/docker/.env
#
#   # Run:
#   ./tests/docker/run-real-camera-smoke.sh
#
# Or pass env vars inline:
#
#   WYZE_USERNAME=you@example.com WYZE_PASSWORD=... \
#   WYZE_KEY_ID=... WYZE_API_KEY=... WYZE_CAMERA_NICK="<your camera nickname>" \
#     ./tests/docker/run-real-camera-smoke.sh
#
# IMPORTANT: this runs the container with --network host so it can reach
# your Wyze cameras on the LAN over UDP. On Docker Desktop for Mac that
# means the container shares the VM's network (not your host's directly),
# so cameras must be reachable from the Docker VM's network too — which
# they are by default with Docker Desktop's bridged-to-host networking.

set -euo pipefail

if [ ! -f "tests/docker/Dockerfile.real-camera" ]; then
  echo "error: run this from the wyze-api repo root" >&2
  exit 1
fi

# Load .env if present (overridden by anything already in the env).
if [ -f "tests/docker/.env" ]; then
  # shellcheck disable=SC1091
  set -a
  source tests/docker/.env
  set +a
fi

MISSING=""
for v in WYZE_USERNAME WYZE_PASSWORD WYZE_KEY_ID WYZE_API_KEY; do
  if [ -z "${!v:-}" ]; then MISSING="$MISSING $v"; fi
done
if [ -n "$MISSING" ]; then
  echo "error: missing required env vars:$MISSING" >&2
  echo "fill in tests/docker/.env (copy from .env.sample) or pass inline." >&2
  exit 2
fi

TAG="wyze-api-real-camera"
PLATFORM_FLAG=""
# Allow override (e.g. test the amd64 .so on an arm64 host).
if [ -n "${TARGET_PLATFORM:-}" ]; then
  PLATFORM_FLAG="--platform $TARGET_PLATFORM"
  echo "→ forcing platform: $TARGET_PLATFORM"
fi

echo "→ docker build $PLATFORM_FLAG -f tests/docker/Dockerfile.real-camera -t $TAG ."
docker build $PLATFORM_FLAG -f tests/docker/Dockerfile.real-camera -t "$TAG" . >/dev/null

echo
echo "→ docker run --rm --network host $PLATFORM_FLAG <creds> -e WYZE_CAMERA_NICK='${WYZE_CAMERA_NICK:-(first online)}' $TAG"
echo

docker run --rm --network host $PLATFORM_FLAG \
  -e WYZE_USERNAME -e WYZE_PASSWORD \
  -e WYZE_KEY_ID -e WYZE_API_KEY \
  -e WYZE_CAMERA_NICK \
  "$TAG"
