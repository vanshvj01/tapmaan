/**
 * data-service — Data Acquisition Layer.
 *
 * The only service that talks to the outside world for weather data. It owns
 * the Open-Meteo integration, the 15-minute cache and the deterministic
 * fallback series. Every other service calls it over HTTP.
 *
 *   GET /internal/stations                         station network metadata
 *   GET /internal/series?station=nagpur&days=7     one station's daily series
 *   GET /internal/series/all?days=7                every station, in parallel
 *   (all accept &scenario=peak-summer)
 *
 * Internal routes are not exposed through the gateway.
 */

if (process.env.DATA_SERVICE_URL) {
  // Pointing the data-service at itself would recurse forever.
  console.error('data-service must not have DATA_SERVICE_URL set');
  process.exit(1);
}

const { createService } = require('../shared/runtime');
const { STATIONS, REGIONS } = require('../../api/_lib/heat');
const { fetchStation, fetchAll, scenarioFrom } = require('../../api/_lib/provider');
const { ok, fail } = require('../../api/_lib/respond');

function horizon(q) {
  return Math.min(Math.max(parseInt(q.days, 10) || 7, 1), 10);
}

function sourceOf(series) {
  if (!series.length) return 'none';
  if (series[0].scenario) return 'scenario';
  return series[0].synthetic ? 'fallback' : 'open-meteo';
}

createService({
  name: 'data-service',
  port: parseInt(process.env.PORT, 10) || 4000,
  routes: {
    '/internal/stations': (req, res) =>
      ok(res, { regions: REGIONS, stations: STATIONS }),

    '/internal/series': async (req, res) => {
      const station = STATIONS.find(s => s.id === req.query.station);
      if (!station) return fail(res, 404, `Unknown station: ${req.query.station}`);
      const series = await fetchStation(station, horizon(req.query), scenarioFrom(req.query));
      return ok(res, { stationId: station.id, dataSource: sourceOf(series), series });
    },

    '/internal/series/all': async (req, res) => {
      const all = await fetchAll(horizon(req.query), scenarioFrom(req.query));
      return ok(res, {
        results: all.map(({ station, series }) => ({
          stationId: station.id, dataSource: sourceOf(series), series
        }))
      });
    }
  }
});
