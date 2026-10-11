#!/usr/bin/env sh
# Smoke test the running stack through the gateway.
#   ./scripts/smoke-test.sh                    defaults to http://localhost:8080
#   ./scripts/smoke-test.sh http://<host>:<port>
# Used locally, in CI after `docker compose up`, and in the demo.

BASE="${1:-http://localhost:8080}"
FAILED=0

check() {
  name="$1"; shift
  body=$(curl -s --max-time 20 "$@")
  if echo "$body" | grep -q '"ok":true'; then
    echo "  pass  $name"
  else
    echo "  FAIL  $name -> $(echo "$body" | head -c 160)"
    FAILED=1
  fi
}

expect_status() {
  name="$1"; want="$2"; url="$3"
  got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url")
  if [ "$got" = "$want" ]; then echo "  pass  $name ($got)"; else echo "  FAIL  $name (got $got, want $want)"; FAILED=1; fi
}

echo "Smoke testing $BASE"
expect_status "gateway health"            200 "$BASE/health"
expect_status "frontend index"            200 "$BASE/"
expect_status "frontend forecast page"    200 "$BASE/forecast.html"
check "monitoring-service  /api/observations"  "$BASE/api/observations?demo=1"
check "forecast-service    /api/forecast"      "$BASE/api/forecast?station=nagpur&demo=1"
check "hotspot-service     /api/hotspots"      "$BASE/api/hotspots?demo=1"
check "advisory-service    /api/advisory"      "$BASE/api/advisory?station=nagpur&audience=farmers&demo=1"
check "alert-service       /api/alerts"        "$BASE/api/alerts?demo=1"
check "alert-service       /api/subscribe"     -X POST -H 'Content-Type: application/json' \
      -d '{"station":"nagpur","channel":"email","language":"english","contact":"test@example.com"}' \
      "$BASE/api/subscribe"
expect_status "internal routes are not exposed" 404 "$BASE/api/internal/series/all"

if [ "$FAILED" -eq 0 ]; then echo "All smoke checks passed."; else echo "Smoke test FAILED."; fi
exit $FAILED
