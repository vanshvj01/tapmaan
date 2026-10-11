/**
 * Tapmaan — meteorological data provider.
 *
 * Live observations and forecasts come from Open-Meteo, which is free and
 * requires no API key. If the upstream call fails, a deterministic synthetic
 * series is returned instead so the platform degrades rather than breaking.
 *
 * In the full use-case architecture this module is the Data Acquisition Layer:
 * swap the fetch for the IMD GRD ingestion pipeline and nothing downstream
 * needs to change.
 */

const { STATIONS, heatIndex } = require('./heat');

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  return null;
}

function store(key, value) {
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------------
// Deterministic fallback — seeded so the same station gives the same series
// ---------------------------------------------------------------------------

function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function syntheticSeries(station, days, scenario) {
  const rand = seededRandom(station.id + new Date().toISOString().slice(0, 10) + (scenario || ''));
  const out = [];
  const month = new Date().getMonth() + 1;

  // Seasonal swing around the station normal. The peak-summer scenario forces
  // pre-monsoon conditions so the warning pipeline can be demonstrated outside
  // the heatwave season; it is always labelled as such in the response.
  const seasonalOffset = scenario === 'peak-summer'
    ? 4.8
    : [3, 4, 5].includes(month) ? 3.2 : [6, 7, 8, 9].includes(month) ? -3.5 : -1.0;

  for (let i = 0; i < days; i++) {
    const drift = Math.sin(i / 2.2) * 1.1;
    const noise = (rand() - 0.5) * 1.5;
    const max = Math.round((station.normalMax + seasonalOffset + drift + noise) * 10) / 10;

    // Night minimum tracks the station's climatology, not the inflated maximum,
    // with a smaller elevation during a heat spell. Tying it to max produces
    // physically impossible values.
    const nightLift = scenario === 'peak-summer' ? 2.5 : 0;
    const min = Math.round((station.normalMax - 12.5 + nightLift + rand() * 2.5) * 10) / 10;
    const rh = Math.round(station.terrain === 'coastal' ? 62 + rand() * 20 : 28 + rand() * 22);
    const date = new Date();
    date.setDate(date.getDate() + i);
    out.push({
      date: date.toISOString().slice(0, 10),
      maxTemp: max,
      minTemp: min,
      humidity: rh,
      windSpeed: Math.round((6 + rand() * 12) * 10) / 10,
      synthetic: true,
      scenario: scenario || null
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live fetch
// ---------------------------------------------------------------------------

async function fetchStation(station, days = 7, scenario) {
  // A named scenario bypasses the live feed entirely and is always labelled.
  if (scenario) return syntheticSeries(station, days, scenario);

  const key = `${station.id}:${days}`;
  const hit = cached(key);
  if (hit) return hit;

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${station.lat}&longitude=${station.lon}`
    + '&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,wind_speed_10m_max'
    + '&timezone=Asia%2FKolkata'
    + `&forecast_days=${days}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error('upstream ' + res.status);
    const json = await res.json();
    const d = json.daily;
    if (!d || !d.time) throw new Error('malformed response');

    const series = d.time.map((date, i) => ({
      date,
      maxTemp: Math.round(d.temperature_2m_max[i] * 10) / 10,
      minTemp: Math.round(d.temperature_2m_min[i] * 10) / 10,
      humidity: Math.round(d.relative_humidity_2m_mean[i]),
      windSpeed: Math.round(d.wind_speed_10m_max[i] * 10) / 10,
      synthetic: false
    }));

    return store(key, series);
  } catch (err) {
    console.warn('[provider] falling back for', station.id, '-', err.message);
    return store(key, syntheticSeries(station, days));
  }
}

/** Fetch every station in parallel. */
async function fetchAll(days = 7, scenario) {
  const key = `all:${days}:${scenario || 'live'}`;
  const hit = cached(key);
  if (hit) return hit;

  const results = await Promise.all(
    STATIONS.map(async station => ({
      station,
      series: await fetchStation(station, days, scenario)
    }))
  );
  return store(key, results);
}

/** Normalise the scenario query parameter. Only one scenario is recognised. */
function scenarioFrom(query) {
  const v = (query && (query.scenario || query.demo)) || '';
  return (v === 'peak-summer' || v === '1' || v === 'true') ? 'peak-summer' : null;
}

/** Attach a computed heat index to each day in a series. */
function withHeatIndex(series) {
  return series.map(d => ({ ...d, heatIndex: heatIndex(d.maxTemp, d.humidity) }));
}

const local = { fetchStation, fetchAll, withHeatIndex, scenarioFrom, remote: false };

// Microservice mode: when DATA_SERVICE_URL is set (every domain service except
// the data-service itself), station data is fetched over HTTP from the
// data-service instead of directly from Open-Meteo. On Vercel the variable is
// unset and behaviour is exactly as before.
module.exports = process.env.DATA_SERVICE_URL
  ? { ...local, ...require('./remote-provider') }
  : local;
