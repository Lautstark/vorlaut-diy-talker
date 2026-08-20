#!/usr/bin/env bash
#
# Beendet die Weboberfläche - egal ob sie im Container läuft oder direkt
# gestartet wurde.
#
#   ./stop.sh          Port 8771
#   ./stop.sh 8798     anderer Port

set -uo pipefail
cd "$(dirname "$0")"
PORT="${1:-8771}"

echo "Container:"
if [ -n "$(docker ps -aq --filter name=mitreden 2>/dev/null)" ]; then
  docker compose down
  echo "  beendet"
else
  echo "  keiner vorhanden"
fi

# Ein direkt gestartetes app.py hört Docker nicht - das muss man selbst
# beenden. Absichtlich nur melden statt ungefragt abschießen.
echo "Direkt gestartete Server auf Port $PORT:"
gefunden=""
if command -v lsof >/dev/null 2>&1; then
  gefunden=$(lsof -ti "tcp:$PORT" 2>/dev/null || true)
fi
if [ -z "$gefunden" ]; then
  echo "  keine"
else
  for pid in $gefunden; do
    echo "  PID $pid: $(ps -o command= -p "$pid" | cut -c1-70)"
  done
  echo
  echo "  Beenden mit:  kill $gefunden"
fi

echo
if command -v lsof >/dev/null 2>&1 && [ -z "$(lsof -ti "tcp:$PORT" 2>/dev/null)" ]; then
  echo "Port $PORT ist frei."
fi
