# Tapmaan — Microservice Architecture

Use case: **Climate Intelligence for Heatwave Monitoring, Prediction, and Early
Warning** (KJS-CES-01). DevOps Lab CA: microservice implementation,
documentation and demonstration.

## 1. Why microservices for this use case

A heatwave early-warning system has parts that change, fail and scale for
different reasons:

| Concern | Changes when… | Scales with… |
|---|---|---|
| Data acquisition | the upstream source changes (Open-Meteo → IMD GRD files) | number of stations |
| Monitoring | IMD revises classification criteria | dashboard traffic |
| Prediction | the model is retrained or replaced | forecast requests (heaviest) |
| Hotspots | the scoring formula is tuned | dashboard traffic |
| Advisories | the LLM or templates change | stakeholder requests |
| Alerts & subscriptions | dispatch channels are added | subscribers |

Splitting along these lines means a new forecast model ships without touching
alerts, the forecast service can run five replicas while hotspots runs one,
and an advisory-service crash does not stop warnings from being issued.

## 2. Services

```
                         ┌──────────────────────────────┐
  Browser ──HTTP:8080──▶ │  gateway  (nginx)            │
                         │  static frontend + /api/*    │
                         └──┬─────┬─────┬─────┬─────┬───┘
            /api/observations│     │     │     │     │/api/alerts, /api/subscribe
                    ┌────────▼┐ ┌──▼───┐ ┌▼────┐ ┌▼─────┐ ┌▼──────┐
                    │monitoring│ │forecast│ │hotspot│ │advisory│ │ alert │
                    │  :4001   │ │ :4002 │ │ :4003 │ │ :4004  │ │ :4005 │
                    └────┬─────┘ └──┬────┘ └──┬────┘ └──┬─────┘ └──┬────┘
                         └──────────┴────┬────┴─────────┴──────────┘
                              HTTP /internal/series
                                  ┌──────▼───────┐        ┌──────────────┐
                                  │ data-service │──────▶ │  Open-Meteo  │
                                  │    :4000     │        │  (external)  │
                                  └──────────────┘        └──────────────┘
                                                         ┌──────────────┐
                 Prometheus :9090 ── scrapes /metrics ──▶│ all services │
                 Grafana    :3001 ── dashboards          └──────────────┘
```

| Service | Port | Public routes | Responsibility |
|---|---|---|---|
| **gateway** | 80 (8080 on host) | `/`, `/*.html`, `/api/*` | Serves the frontend, routes each API path to its owner, returns JSON 503 when an owner is down, hides `/internal` routes |
| **data-service** | 4000 | none (internal only) | Sole owner of Open-Meteo access, 15-minute cache, deterministic fallback series, scenario mode |
| **monitoring-service** | 4001 | `GET /api/observations` | Today's conditions for 25 stations classified against IMD criteria |
| **forecast-service** | 4002 | `GET /api/forecast` | 7-day prediction, per-day IMD class, heatwave probability (logistic model widened by lead time), onset and lead time |
| **hotspot-service** | 4003 | `GET /api/hotspots` | Hotspot score (departure + persistence + warm nights + humidity) and regional aggregation |
| **advisory-service** | 4004 | `GET/POST /api/advisory` | Stakeholder-specific advisories for citizens, workers, farmers, health and authorities; LLM with factual grounding, template fallback |
| **alert-service** | 4005 | `GET /api/alerts`, `POST /api/subscribe` | Early-warning queue with human-approval flag for severe warnings; subscriber registration with contact masking |

Every service also exposes `GET /health` (used by Docker healthchecks and
Kubernetes probes) and `GET /metrics` (Prometheus).

## 3. Design decisions

**Same handler code on Vercel and in containers.** The route handlers in
`api/` are unchanged. `services/shared/runtime.js` is a ~150-line wrapper
around Node's `http` module that supplies the `req.query`, `req.body` and
`res.status().send()` interface the handlers expect. The Vercel deployment
keeps working from the same repository.

**Database-per-service, applied to data access.** Only data-service calls the
external weather API. Domain services ask it over HTTP
(`api/_lib/remote-provider.js`). The switch is a single environment variable,
`DATA_SERVICE_URL`; the provider interface (`fetchStation`, `fetchAll`) is
identical in both modes, so no handler knows which mode it is in.

**No external dependencies.** Each image is `node:22-alpine` plus the source
files that service needs — no `npm install`, so builds are fast and the
attack surface is small. Images run as a non-root numeric user.

**Graceful degradation at three levels.**

1. Open-Meteo unreachable → data-service returns a labelled fallback series.
2. data-service unreachable → domain services serve their last good response
   for up to 15 minutes; past that, a precise `503 Data service unavailable`.
3. A domain service down → the gateway returns
   `503 "<service> is temporarily unavailable. The rest of Tapmaan is still running."`
   for that service's routes only. The gateway resolves upstreams per request,
   so it starts and runs even with services missing.

**Human in the loop.** Severe warnings carry `requiresApproval: true` and are
held for meteorologist review rather than dispatched automatically.

## 4. Inter-service communication

Synchronous REST over the private Docker network (`tapmaan`) or the
Kubernetes cluster network. Services address each other by name
(`http://data-service:4000`); nothing but the gateway publishes a port.

Example request path for `GET /api/forecast?station=nagpur`:

1. Browser → gateway `:8080`
2. gateway → forecast-service `:4002`
3. forecast-service → data-service `:4000/internal/series?station=nagpur&days=7`
4. data-service → Open-Meteo (or cache / fallback)
5. forecast-service applies IMD classification and the probability model
6. Response flows back with `dataSource` stating where the numbers came from

## 5. DevOps pipeline

```
 git push ──▶ GitHub Actions
               ├─ test         npm test (15 domain checks) + node --check on every service
               ├─ integration  docker compose up --build --wait
               │               smoke test all routes through the gateway
               │               stop hotspot-service → assert 503 there, 200 elsewhere
               └─ publish      (main only) 7 images → ghcr.io/vanshvj01/tapmaan-<service>
                               tagged :<commit-sha> and :latest
```

| Stage | Tool | File |
|---|---|---|
| Source control | Git, GitHub | — |
| CI/CD | GitHub Actions | `.github/workflows/ci-cd.yml` |
| Containerisation | Docker (one Dockerfile per service) | `services/*/Dockerfile`, `gateway/Dockerfile` |
| Local orchestration | Docker Compose | `docker-compose.yml` |
| Cluster orchestration | Kubernetes (minikube), Kustomize, HPA | `k8s/` |
| Registry | GitHub Container Registry | (pushed by CI) |
| Monitoring | Prometheus, Grafana | `monitoring/` |
| Logging | Structured JSON request logs per service; nginx log names the upstream | `docker compose logs` |

## 6. Kubernetes

`kubectl apply -k k8s/` creates namespace `tapmaan` with:

- one Deployment and ClusterIP Service per microservice
- readiness and liveness probes on `/health`
- CPU and memory requests/limits on every container
- 2 replicas for gateway, monitoring and forecast; 1 for the rest
- a HorizontalPodAutoscaler scaling forecast-service from 2 to 5 replicas at 60% CPU
- the gateway exposed as NodePort `30080`
- `ANTHROPIC_API_KEY` read from an optional Secret `tapmaan-secrets`

## 7. Monitoring

Prometheus scrapes every service every 10 s. The provisioned Grafana dashboard
"Tapmaan — Microservices" shows service up/down, requests per second, 5xx
rate, p95 latency and memory per service. Alert rules fire on a service down
for 30 s, an error rate above 20%, or p95 latency above 2 s.

## 8. Known limits

- Subscriber storage is in-memory inside alert-service; it resets on restart.
  The next step is a Postgres or Redis container owned by alert-service.
- Inter-service calls are synchronous. A message queue between forecast and
  alert dispatch would decouple them further.
- The heatwave probability is an inspectable logistic function, not a trained
  model; a gradient-boosting model can replace it behind the same interface
  inside forecast-service alone.
