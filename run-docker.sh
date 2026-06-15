#!/usr/bin/env bash
# Run login-demo in Docker (detached, auto-restart).
#
#   ./run-docker.sh
#   CAP_URL=http://cap:3002 PORT=4173 ./run-docker.sh
#
# Requires CAP_SECRET in the environment (or --env-file .env via ENV_FILE).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE="${IMAGE:-login-demo}"
CONTAINER_NAME="${CONTAINER_NAME:-login-demo}"
PORT="${PORT:-4173}"
CAP_URL="${CAP_URL:-http://localhost:3002}"
ENV_FILE="${ENV_FILE:-}"

if [[ -z "${CAP_SECRET:-}" && -z "$ENV_FILE" ]]; then
  echo "CAP_SECRET is not set. Export it or set ENV_FILE=.env" >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" &>/dev/null; then
  echo "Image $IMAGE not found — building from ${SCRIPT_DIR}..."
  docker build -t "$IMAGE" "$SCRIPT_DIR"
fi

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

RUN_OPTS=(
  -d
  --name "$CONTAINER_NAME"
  --restart unless-stopped
  -p "${PORT}:${PORT}"
  -e "PORT=${PORT}"
  -e "CAP_URL=${CAP_URL}"
)

if [[ -n "$ENV_FILE" ]]; then
  RUN_OPTS+=(--env-file "$ENV_FILE")
else
  RUN_OPTS+=(-e CAP_SECRET)
fi

docker run "${RUN_OPTS[@]}" "$IMAGE"

echo "Running: $CONTAINER_NAME (restart=unless-stopped, http://localhost:${PORT})"
docker ps --filter "name=^${CONTAINER_NAME}$"
