#!/usr/bin/env bash
#
# Starts the web interface in the container - whether one is running or not,
# and always with the current state.
#
# For whoever has the clone. An install has the compose file and nothing else,
# and "docker compose up -d --wait" is the whole of starting it; this exists
# because working on the project means doing that twenty times an afternoon,
# with the same three things to get wrong each time.
#
#   ./start.sh              on port 8771
#   ./start.sh 8798         on another port
#   ./start.sh --build      build the image here first instead of pulling it
#
# At heart there is a single command behind it:
#   docker compose up -d --wait
# That fetches the published image the first time, replaces a running
# container, and comes back once the interface really answers rather than
# once the container has started. The image carries a healthcheck, so that
# last part costs nothing here - it used to be a curl loop counting to thirty.
# On a Compose older than 2.1, which does not know --wait, this script watches
# that same healthcheck itself and behaves the same way.
#
# The code in the container comes from the image, not from this folder, so
# a changed app.py needs --build like everything else. That is the price of
# the image being what actually runs; docker-compose.build.yml puts the
# source mount back for whoever is editing Python all afternoon.

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

if [ ! -f data/.env ]; then
  echo "Note: no data/.env - and none is needed. The image brings four voices"
  echo "      and speaks straight away. An Azure key goes in through the gear"
  echo "      in the interface, which writes that file itself."
  echo
fi

# The container writes into data/ as a user who is not root. A missing one is
# not something Docker handles the same way everywhere: it either refuses to
# start the container, or creates the folder as root - and then the container
# cannot write into it, which is the quieter of the two failures. Making it
# here, as whoever ran this, avoids both.
mkdir -p data

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

# --wait is where the waiting went. It returns when the healthcheck in the
# image passes, which is the interface answering - and it fails the command if
# the container never gets there, so there is nothing to check afterwards.
#
# But it arrived in Compose 2.1, and an older one does not ignore what it does
# not know: it refuses the whole command with "unknown flag: --wait" and
# starts nothing at all. That is not a hypothetical - the Compose 1 in
# Synology's older Docker package does exactly that, and so did the 2.0 that
# was on this laptop until it was upgraded. So ask once whether the flag
# exists, and if it does not, watch the same healthcheck by hand. The waiting
# is worth keeping either way: the first start seeds the speech cache and is
# not ready when it is up.
WAIT=""
if docker compose up --help 2>&1 | grep -q -- --wait; then
  WAIT="--wait"
fi

# What --wait would have done. Polls the healthcheck the image already
# carries, so the definition of "ready" is the same one either way. Ten
# minutes, because the first start pulls a gigabyte of voices before it begins
# seeding.
wait_for_health() {
  local waited=0 status health
  while [ "$waited" -lt 600 ]; do
    status=$(docker inspect -f '{{.State.Status}}' vorlaut 2>/dev/null || true)
    health=$(docker inspect -f '{{.State.Health.Status}}' vorlaut 2>/dev/null || true)
    if [ "$health" = healthy ]; then
      return 0
    fi
    if [ "$health" = unhealthy ] || [ "$status" = exited ]; then
      return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# The arguments go through "set --" rather than an array, because the two
# cases differ at both ends of the command and the failure branch below should
# only be written once. An empty array would have done it just as well
# everywhere except the bash 3.2 that macOS still ships, where expanding one
# under "set -u" is an error. $WAIT is unquoted for the same reason: quoted, an
# empty one would be an empty argument rather than no argument.
if [ -n "$BUILD" ]; then
  echo "Building and starting ..."
  set -- -f docker-compose.yml -f docker-compose.build.yml up -d $WAIT --build
else
  # The first start fetches the image and takes a few minutes over it; every
  # one after that has it already.
  echo "Starting ..."
  set -- up -d $WAIT
fi

started=1
if ! docker compose "$@"; then
  started=""
elif [ -z "$WAIT" ]; then
  echo "Waiting for it to answer ..."
  wait_for_health || started=""
fi

if [ -z "$started" ]; then
  echo
  echo "The server did not come up. What it says itself:"
  docker compose logs --tail 20
  exit 1
fi

echo
echo "Running: http://localhost:$PORT"
echo
echo "  Log:   docker compose logs -f"
echo "  Stop:  docker compose down"
