/**
 * Remote data provider — used when the platform runs as microservices.
 *
 * When DATA_SERVICE_URL is set, provider.js delegates fetchStation and
 * fetchAll here. Instead of calling Open-Meteo directly, each domain service
 * asks the data-service over HTTP. That makes the data-service the single
 * owner of upstream access, caching and fallback, and keeps the domain
 * services stateless.
 *
 * The function signatures are identical to the local provider, so no handler
 * in api/ needs to know which mode it is running in.
 *
 * Resilience: the last good response is kept for 15 minutes, so a brief
 * data-service outage or restart is masked rather than surfacing as errors.
 */

const { STATIONS } = require('./heat');

const BASE = (process.env.DATA_SERVICE_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = parseInt(process.env.DATA_SERVICE_TIMEOUT_MS, 10) || 10000;
const STALE_TTL_MS = 15 * 60 * 1000;

const lastGood = new Map();

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { signal: controller.signal });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || `data-service ${res.status}`);
    lastGood.set(path, { at: Date.now(), body });
    return body;
  } catch (err) {
    const stale = lastGood.get(path);
    if (stale && Date.now() - stale.at < STALE_TTL_MS) {
      console.warn('[remote-provider] data-service unreachable, serving cached copy:', err.message);
      return stale.body;
    }
    const e = new Error('Data service unavailable: ' + err.message);
    e.status = 503;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function qs(days, scenario) {
  return `days=${days}` + (scenario ? `&scenario=${encodeURIComponent(scenario)}` : '');
}

async function fetchStation(station, days = 7, scenario) {
  const body = await getJson(`/internal/series?station=${encodeURIComponent(station.id)}&${qs(days, scenario)}`);
  return body.series;
}

async function fetchAll(days = 7, scenario) {
  const body = await getJson(`/internal/series/all?${qs(days, scenario)}`);
  const byId = new Map(STATIONS.map(s => [s.id, s]));
  return body.results
    .filter(r => byId.has(r.stationId))
    .map(r => ({ station: byId.get(r.stationId), series: r.series }));
}

module.exports = { fetchStation, fetchAll, remote: true, dataServiceUrl: BASE };
