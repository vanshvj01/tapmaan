#!/usr/bin/env sh
# Run every microservice as a plain Node process, without Docker.
# Useful for development on a machine without Docker. Ctrl+C stops them all.
#
#   ./scripts/run-local.sh
#
# Services then answer directly on their own ports:
#   data-service 4000   monitoring 4001   forecast 4002
#   hotspot 4003        advisory 4004     alert 4005
# e.g. curl "http://localhost:4002/api/forecast?station=nagpur&demo=1"

cd "$(dirname "$0")/.." || exit 1

PIDS=""
start() {
  name="$1"; port="$2"; shift 2
  env PORT="$port" "$@" node "services/$name/server.js" &
  PIDS="$PIDS $!"
}

start data-service       4000
sleep 1
export DATA_SERVICE_URL=http://localhost:4000
start monitoring-service 4001
start forecast-service   4002
start hotspot-service    4003
start advisory-service   4004
start alert-service      4005

trap 'kill $PIDS 2>/dev/null; exit 0' INT TERM
echo "All services started. Ctrl+C to stop."
wait
