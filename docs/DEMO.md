# Demo script (about 7 minutes)

Prerequisites on the demo laptop: Docker Desktop running, the repo cloned,
images built once beforehand (`docker compose build`) so nothing downloads
live. Optional for step 6: `docker compose --profile monitoring pull`.

Open three things before you start: a terminal in the repo, a browser, and
the repository's **Actions** tab on GitHub.

---

## 1. The problem and the split (1 min)

Show `docs/ARCHITECTURE.md`, section 2. One sentence per service. The key
line: *"Only the data-service talks to the outside world; every other service
asks it over HTTP."*

## 2. Start the whole platform with one command (1 min)

```bash
docker compose up --build -d --wait
docker compose ps
```

Point out seven containers, all `healthy`, and that only the gateway
publishes a port (8080).

## 3. Use it (1.5 min)

Open <http://localhost:8080> and click **View a peak-summer scenario** in the
banner (outside March–June there are no real heatwaves).

- **Forecast** page → Nagpur: 7-day prediction, IMD class and probability per day
- **Alerts** page → warning queue; severe ones show "awaiting approval"
- **Advisory** page → switch audience to Farmers, then Health agencies

Then show a service answering on its own route:

```bash
curl -s "http://localhost:8080/api/forecast?station=nagpur&demo=1" | head -c 400
```

## 4. Prove independence — kill a service (1.5 min) ← the key moment

```bash
docker compose stop hotspot-service
```

Refresh the **Hotspots** page: it shows *"hotspot-service is temporarily
unavailable. The rest of Tapmaan is still running."* Now open **Forecast**
and **Alerts** — both still work.

```bash
docker compose start hotspot-service
```

Hotspots is back within seconds, with no restart of anything else.

Optional second round: `docker compose stop data-service`, then reload the
Forecast page for Nagpur. It still loads, because forecast-service serves its
last good copy. Start data-service again.

## 5. CI/CD pipeline (1.5 min)

Make a visible one-line change (for example, a word in `public/about.html`),
then:

```bash
git add -A && git commit -m "Demo: update about page" && git push
```

In the **Actions** tab, walk through the three jobs: unit tests →
integration (compose up, smoke test, kill-a-service test) → publish seven
images to GitHub Container Registry. Show the packages on the repository page.

If the network is slow, show the last green run instead of waiting.

## 6. Monitoring (optional, 1 min)

```bash
docker compose --profile monitoring up -d
./scripts/smoke-test.sh          # generate some traffic
```

Grafana at <http://localhost:3001> → Dashboards → Tapmaan → *Tapmaan —
Microservices*. Stop a service again and watch its tile turn red. Prometheus
alerts at <http://localhost:9090/alerts>.

## 7. Kubernetes (optional, if minikube is set up)

```bash
minikube start && minikube addons enable metrics-server
eval $(minikube docker-env) && docker compose build
kubectl apply -k k8s/
kubectl get pods -n tapmaan
minikube service gateway -n tapmaan
```

Show `kubectl get hpa -n tapmaan`, and delete a pod to show Kubernetes
replacing it: `kubectl delete pod -n tapmaan -l app=forecast-service`.

---

## Likely viva questions

**Why not one service?** Different change and scaling rates (see the table in
ARCHITECTURE.md §1). A crash in one part must not stop warnings.

**How do services find each other?** By DNS name on the Docker network or
Kubernetes Service; the gateway resolves per request so it survives missing
services.

**What happens if Open-Meteo is down?** data-service returns a deterministic
fallback series labelled `dataSource: "fallback"`.

**Where is the AI?** forecast-service (heatwave probability over forecast
departure, decaying with lead time) and advisory-service (LLM-drafted
advisories restricted to verified figures, with a template fallback).

**How is a severe warning controlled?** It carries `requiresApproval` and is
held for meteorologist review.

**What would you add next?** Postgres for subscribers, a message queue
between forecast and alerts, a trained gradient-boosting model.
