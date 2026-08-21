#!/usr/bin/env bash
#
# Stops the web interface - whether it runs in the container or was started
# directly.
#
#   ./stop.sh          port 8771
#   ./stop.sh 8798     another port

set -uo pipefail
cd "$(dirname "$0")"
PORT="${1:-8771}"

echo "Container:"
if [ -n "$(docker ps -aq --filter name=vorlaut 2>/dev/null)" ]; then
  docker compose down
  echo "  stopped"
else
  echo "  none there"
fi

# Docker does not hear about an app.py that was started directly - that one
# has to be stopped by hand. Deliberately only reported, not killed unasked.
echo "Directly started servers on port $PORT:"
found=""
if command -v lsof >/dev/null 2>&1; then
  found=$(lsof -ti "tcp:$PORT" 2>/dev/null || true)
fi
if [ -z "$found" ]; then
  echo "  none"
else
  for pid in $found; do
    echo "  PID $pid: $(ps -o command= -p "$pid" | cut -c1-70)"
  done
  echo
  echo "  Stop it with:  kill $found"
fi

echo
if command -v lsof >/dev/null 2>&1 && [ -z "$(lsof -ti "tcp:$PORT" 2>/dev/null)" ]; then
  echo "Port $PORT is free."
fi
