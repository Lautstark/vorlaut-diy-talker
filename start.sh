#!/usr/bin/env bash
#
# Startet die Weboberfläche im Container - egal ob gerade einer läuft oder
# nicht, und immer mit dem aktuellen Stand.
#
#   ./start.sh              auf Port 8771
#   ./start.sh 8798         auf einem anderen Port
#
# Dahinter steckt im Kern ein einziger Befehl:
#   docker compose up -d --build
# Der baut neu, falls sich Dockerfile oder requirements.txt geändert haben,
# und ersetzt einen laufenden Container. Der Python-Code kommt ohnehin aus
# diesem Ordner, nicht aus dem Abbild - ein Neustart genügt dafür.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8771}"
export MITREDEN_PORT="$PORT"

if [ ! -f .env ]; then
  echo "Hinweis: keine .env - ohne Azure-Schlüssel bleibt es stumm."
  echo "         Vorlage: cp .env.example .env"
  echo
fi

# Belegt etwas den Port außerhalb von Docker? Meist ein direkt gestartetes
# app.py. Beide gleichzeitig auf denselben Dateien wäre keine gute Idee.
if command -v lsof >/dev/null 2>&1; then
  fremd=$(lsof -ti "tcp:$PORT" 2>/dev/null | while read -r pid; do
            ps -o command= -p "$pid" | grep -q "[a]pp.py" && echo "$pid"
          done || true)
  if [ -n "$fremd" ]; then
    echo "Auf Port $PORT läuft bereits ein app.py (PID $fremd)."
    echo "Erst beenden, oder den Container auf einen anderen Port legen:"
    echo "  ./start.sh 8798"
    exit 1
  fi
fi

# Ein Container dieses Namens kann aus einem früheren Lauf übrig sein, auch
# gestoppt - dann verweigert Docker den Namen. Vorher wegräumen, statt an
# "name is already in use" zu scheitern.
if [ -n "$(docker ps -aq --filter name='^mitreden$' 2>/dev/null)" ]; then
  docker rm -f mitreden >/dev/null 2>&1 || true
fi

echo "Baue und starte ..."
docker compose up -d --build

# Warten, bis die Oberfläche wirklich antwortet - "gestartet" heißt noch
# nicht "bereit".
printf "Warte auf den Server "
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo
    echo "Läuft: http://localhost:$PORT"
    echo
    echo "  Protokoll:  docker compose logs -f"
    echo "  Beenden:    docker compose down"
    exit 0
  fi
  printf "."
  sleep 1
done

echo
echo "Der Server antwortet nicht. Was sagt er selbst:"
docker compose logs --tail 20
exit 1
