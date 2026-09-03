/**
 * GET /api/observations
 *   ?region=Central India   optional filter
 *   ?station=nagpur         single station detail
 *
 * Returns today's conditions for the station network with IMD severity
 * classification applied. This is the Monitoring endpoint.
 */

const { STATIONS, REGIONS, classify, heatIndex, seasonFor, SEVERITY_LABEL, SEVERITY_RANK } = require('./_lib/heat');
const { fetchAll, fetchStation, scenarioFrom } = require('./_lib/provider');
const { ok, fail, preflight } = require('./_lib/respond');

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    const { region, station: stationId } = req.query || {};
    const scenario = scenarioFrom(req.query);

    if (stationId) {
      const station = STATIONS.find(s => s.id === stationId);
      if (!station) return fail(res, 404, `Unknown station: ${stationId}`);

      const series = await fetchStation(station, 7, scenario);
      const today = series[0];
      const cls = classify(station, today.maxTemp);

      return ok(res, {
        station: {
          ...station,
          observedAt: today.date,
          maxTemp: today.maxTemp,
          minTemp: today.minTemp,
          humidity: today.humidity,
          windSpeed: today.windSpeed,
          heatIndex: heatIndex(today.maxTemp, today.humidity),
          severity: cls.severity,
          severityLabel: SEVERITY_LABEL[cls.severity],
          departure: cls.departure,
          criterion: cls.criterion,
          dataSource: today.synthetic ? 'fallback' : 'open-meteo'
        }
      });
    }

    const all = await fetchAll(7, scenario);

    let rows = all.map(({ station, series }) => {
      const today = series[0];
      const cls = classify(station, today.maxTemp);
      return {
        id: station.id,
        name: station.name,
        state: station.state,
        region: station.region,
        lat: station.lat,
        lon: station.lon,
        terrain: station.terrain,
        normalMax: station.normalMax,
        maxTemp: today.maxTemp,
        minTemp: today.minTemp,
        humidity: today.humidity,
        heatIndex: heatIndex(today.maxTemp, today.humidity),
        departure: cls.departure,
        severity: cls.severity,
        severityLabel: SEVERITY_LABEL[cls.severity],
        criterion: cls.criterion,
        dataSource: today.synthetic ? 'fallback' : 'open-meteo'
      };
    });

    if (region) rows = rows.filter(r => r.region === region);

    rows.sort((a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.departure - a.departure);

    const counts = rows.reduce((acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    }, {});

    return ok(res, {
      scenario,
      season: seasonFor(new Date()),
      regions: REGIONS,
      summary: {
        stations: rows.length,
        underWarning: rows.filter(r => SEVERITY_RANK[r.severity] >= 2).length,
        hottest: rows.length ? rows.reduce((a, b) => (a.maxTemp > b.maxTemp ? a : b)).name : null,
        counts
      },
      observations: rows
    });
  } catch (err) {
    console.error('[observations]', err);
    return fail(res, 500, 'Could not assemble observations. Try again shortly.');
  }
};
