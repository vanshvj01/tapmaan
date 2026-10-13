#!/usr/bin/env bash
# One-command demo setup for Tapmaan. Run from the repository root in Git Bash
# (Windows) or Terminal (Mac/Linux):
#
#   bash scripts/setup-demo.sh            Docker Compose stack + monitoring
#   bash scripts/setup-demo.sh --k8s      ...and the Kubernetes (minikube) part
#
# Safe to run again: each step skips or refreshes what is already there.

set -u
cd "$(dirname "$0")/.." || exit 1

G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'
step() { echo; echo "${B}==> $*${N}"; }
ok()   { echo "${G}  ok${N}  $*"; }
warn() { echo "${Y}  !!${N}  $*"; }
die()  { echo "${R}  FAILED${N}  $*"; echo; echo "Fix the problem above and run this script again."; exit 1; }

WANT_K8S=0
[ "${1:-}" = "--k8s" ] && WANT_K8S=1

# --------------------------------------------------------------- checks
step "Checking prerequisites"
[ -f docker-compose.yml ] || die "docker-compose.yml not found. Run: git checkout microservices   (or git pull after the PR is merged)"
ok "repository has the microservices files"

command -v docker > /dev/null 2>&1 || die "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
docker info > /dev/null 2>&1 || die "Docker is installed but not running. Open Docker Desktop, wait for 'Engine running', then retry."
ok "Docker is running ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"

docker compose version > /dev/null 2>&1 || die "'docker compose' is missing. Update Docker Desktop."
ok "Docker Compose available"

# A previous minikube docker-env in this shell would send builds to the wrong Docker.
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH MINIKUBE_ACTIVE_DOCKERD

# --------------------------------------------------------------- build
step "Building the 7 service images (first time: 5-10 minutes)"
docker compose build || die "image build failed (see output above)"
ok "images built"

step "Downloading Prometheus and Grafana"
docker compose --profile monitoring pull prometheus grafana || warn "could not download monitoring images; the demo still works without step 7"

# --------------------------------------------------------------- run
step "Starting the stack"
docker compose --profile monitoring up -d --wait --wait-timeout 180 \
  || docker compose up -d --wait --wait-timeout 180 \
  || die "containers did not become healthy. Run: docker compose ps   and   docker compose logs"
docker compose --profile monitoring ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'

step "Smoke testing every route through the gateway"
sleep 2
sh scripts/smoke-test.sh http://localhost:${GATEWAY_PORT:-8080} || die "smoke test failed"

# --------------------------------------------------------------- kubernetes
K8S_STATUS="skipped (run with --k8s to set it up)"
if [ $WANT_K8S -eq 1 ]; then
  step "Kubernetes: checking minikube and kubectl"
  command -v minikube > /dev/null 2>&1 || die "minikube is not installed. Windows: winget install -e --id Kubernetes.minikube   Mac: brew install minikube   then open a NEW terminal and rerun."
  ok "minikube found"

  step "Kubernetes: starting minikube (first time: a few minutes)"
  if minikube status --format '{{.Host}}' 2>/dev/null | grep -q Running; then
    ok "minikube already running"
  else
    minikube start --driver=docker --memory=4096 --cpus=2 || die "minikube did not start. In Docker Desktop give it at least 6 GB memory (Settings > Resources), then: minikube delete   and rerun."
  fi
  minikube addons enable metrics-server > /dev/null 2>&1 && ok "metrics-server enabled (for the autoscaler)"

  step "Kubernetes: copying the 7 images into minikube (a few minutes)"
  # Build in Docker Desktop, then load into minikube. Works whichever container
  # runtime minikube uses (docker or containerd); docker-env only works with docker.
  # Attestations are switched off because minikube's loader cannot import them.
  mkdir -p .k8s-images
  REGISTRY=tapmaan TAG=latest BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build -q \
    || die "image build failed"
  for s in data-service monitoring-service forecast-service hotspot-service advisory-service alert-service gateway; do
    docker save "tapmaan/$s:latest" -o ".k8s-images/$s.tar" || die "could not export $s"
    minikube image load ".k8s-images/$s.tar" || die "could not load $s into minikube"
    ok "$s"
  done
  rm -rf .k8s-images

  step "Kubernetes: deploying"
  # minikube's bundled kubectl always matches the cluster version and context.
  # A separately installed kubectl (or Docker Desktop's) can be older or point
  # elsewhere, which shows up as "failed to download openapi".
  K="minikube kubectl --"
  $K config use-context minikube > /dev/null 2>&1
  $K apply -k k8s/ || die "kubectl apply failed"
  $K -n tapmaan rollout restart deployment > /dev/null   # pick up freshly loaded images
  $K -n tapmaan wait --for=condition=available deployment --all --timeout=240s \
    || die "deployments not ready. Check: minikube kubectl -- get pods -n tapmaan"
  $K get pods -n tapmaan

  # Plain "kubectl" is what the demo script uses. Check it works; if not, say how.
  if kubectl get ns tapmaan > /dev/null 2>&1; then
    ok "plain kubectl works against minikube"
    KUBECTL_NOTE=""
  else
    warn "your kubectl command can't talk to minikube (version or path mismatch)."
    KUBECTL_NOTE="  Before the demo, run once per Git Bash window:  alias kubectl=\"minikube kubectl --\""
  fi
  K8S_STATUS="running — open a second Git Bash and run:  minikube kubectl -- -n tapmaan port-forward svc/gateway 8081:80   then visit http://localhost:8081"
fi

# --------------------------------------------------------------- summary
P=${GATEWAY_PORT:-8080}
echo
echo "${G}${B}Tapmaan demo environment is ready.${N}"
echo
echo "  App          http://localhost:$P            (click 'View a peak-summer scenario')"
echo "  Forecast     http://localhost:$P/forecast.html?station=nagpur&demo=1"
echo "  Hotspots     http://localhost:$P/hotspots.html?demo=1"
echo "  Grafana      http://localhost:3001   (Dashboards > Tapmaan)"
echo "  Prometheus   http://localhost:9090"
echo "  Kubernetes   $K8S_STATUS"
[ -n "${KUBECTL_NOTE:-}" ] && echo "$KUBECTL_NOTE"
echo
echo "  Stop everything:   docker compose --profile monitoring down"
echo
