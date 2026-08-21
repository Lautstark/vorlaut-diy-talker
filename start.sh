#!/usr/bin/env bash
#
# Starts the web interface in the container - whether one is running or not,
# and always with the current state.
#
#   ./start.sh              on port 8771
#   ./start.sh 8798         on another port
#   ./start.sh --build      build the image here first instead of pulling it
#
# At heart there is a single command behind it:
#   docker compose up -d
# That fetches the published image the first time, and replaces a running
# container. The Python code comes from this folder anyway, not from the
# image - a restart is enough for that. Only a changed Dockerfile or
# requirements.txt needs a build, which is what --build is for; leaving it
# out of the normal way saves everybody else the wait.

set -euo pipefail
cd "$(dirname "$0")"

# A port, --build, or both, in either order. An unknown option is refused
# rather than taken for a port number - a mistyped --build would otherwise
# end up being waited for on port "--biuld".
PORT=8771
BUILD=""
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) PORT="$arg" ;;
  esac
done
export VORLAUT_PORT="$PORT"

if [ ! -f .env ]; then
  echo "Note: no .env - without an Azure key it stays silent."
  echo "      Template: cp .env.example .env"
  echo
fi

# Is something holding the port outside Docker? Usually an app.py that was
# started directly. Both at once on the same files would be a bad idea.
if command -v lsof >/dev/null 2>&1; then
  other=$(lsof -ti "tcp:$PORT" 2>/dev/null | while read -r pid; do
            ps -o command= -p "$pid" | grep -q "[a]pp.py" && echo "$pid"
          done || true)
  if [ -n "$other" ]; then
    echo "An app.py is already running on port $PORT (PID $other)."
    echo "Stop it first, or put the container on another port:"
    echo "  ./start.sh 8798"
    exit 1
  fi
fi

# A container of this name may be left over from an earlier run, even a
# stopped one - Docker then refuses the name. Clear it away first instead of
# failing on "name is already in use".
if [ -n "$(docker ps -aq --filter name='^vorlaut$' 2>/dev/null)" ]; then
  docker rm -f vorlaut >/dev/null 2>&1 || true
fi

if [ -n "$BUILD" ]; then
  echo "Building and starting ..."
  docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
else
  # The first start fetches the image and takes a few minutes over it; every
  # one after that has it already.
  echo "Starting ..."
  docker compose up -d
fi

# Wait until the interface really answers - "started" does not yet mean
# "ready".
printf "Waiting for the server "
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo
    echo "Running: http://localhost:$PORT"
    echo
    echo "  Log:   docker compose logs -f"
    echo "  Stop:  docker compose down"
    exit 0
  fi
  printf "."
  sleep 1
done

echo
echo "The server does not answer. What it says itself:"
docker compose logs --tail 20
exit 1
