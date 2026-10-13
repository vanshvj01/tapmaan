/**
 * GET /api/forecast?station=nagpur[&days=7]
 *
 * Produces a seven-day maximum temperature forecast with per-day IMD heatwave
 * classification and a calibrated probability of the day meeting heatwave
 * criteria. This is the AI Heatwave Intelligence layer.
 *
 * The probability model is a logistic function over the forecast departure
 * from normal, widened by lead time to reflect declining forecast skill. It is
 * intentionally simple and inspectable; a trained gradient-boosting model can
 * be dropped in behind the same interface.
 */

const { STATIONS, classify, heatIndex, SEVERITY_LABEL, SEVERITY_RANK } = require('./_lib/heat');
const { fetchStation, scenarioFrom } = require('./_lib/provider');
const { ok, fail, preflight } = require('./_lib/respond');

/** Forecast skill decays with lead time; the curve flattens accordingly. */
function heatwaveProbability(departure, leadDays) {
  const slope = 1.15 / (1 + leadDays * 0.16);
  const midpoint = 4.5; // the IMD heatwave departure threshold
  const p = 1 / (1 + Math.exp(-slope * (departure - midpoint)));
  return Math.round(p * 100);
}

function confidenceFor(leadDays) {
  if (leadDays <= 1) return 'high';
  if (leadDays <= 3) return 'moderate';
  return 'indicative';
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    const { station: stationId, days } = req.query || {};
    const scenario = scenarioFrom(req.query);
    const horizon = Math.min(Math.max(parseInt(days, 10) || 7, 1), 10);

    const station = STATIONS.find(s => s.id === (stationId || 'nagpur'));
    if (!station) return fail(res, 404, `Unknown station: ${stationId}`);

    const series = await fetchStation(station, horizon, scenario);

    let consecutive = 0;
    let peakConsecutive = 0;

    const forecast = series.map((d, i) => {
      const cls = classify(station, d.maxTemp);
      const isEvent = SEVERITY_RANK[cls.severity] >= 2;

      consecutive = isEvent ? consecutive + 1 : 0;
      peakConsecutive = Math.max(peakConsecutive, consecutive);

      return {
        date: d.date,
        leadDays: i,
        maxTemp: d.maxTemp,
        minTemp: d.minTemp,
        humidity: d.humidity,
        windSpeed: d.windSpeed,
        heatIndex: heatIndex(d.maxTemp, d.humidity),
        departure: cls.departure,
        severity: cls.severity,
        severityLabel: SEVERITY_LABEL[cls.severity],
        criterion: cls.criterion,
        probability: heatwaveProbability(cls.departure, i),
        confidence: confidenceFor(i)
      };
    });

    const eventDays = forecast.filter(d => SEVERITY_RANK[d.severity] >= 2);
    const peak = forecast.reduce((a, b) => (a.maxTemp > b.maxTemp ? a : b));
    const firstEvent = eventDays[0] || null;

    return ok(res, {
      station: {
        id: station.id, name: station.name, state: station.state,
        region: station.region, terrain: station.terrain, normalMax: station.normalMax
      },
      outlook: {
        horizonDays: horizon,
        eventDays: eventDays.length,
        longestSpell: peakConsecutive,
        peakDate: peak.date,
        peakTemp: peak.maxTemp,
        peakHeatIndex: peak.heatIndex,
        onsetDate: firstEvent ? firstEvent.date : null,
        leadTimeDays: firstEvent ? firstEvent.leadDays : null,
        headline: eventDays.length
          ? `${SEVERITY_LABEL[eventDays[0].severity]} conditions expected in ${station.name} from ${firstEvent.date}, peaking at ${peak.maxTemp}C.`
          : `No heatwave conditions expected in ${station.name} over the next ${horizon} days. Peak of ${peak.maxTemp}C on ${peak.date}.`
      },
      scenario,
      dataSource: scenario ? 'scenario' : series[0].synthetic ? 'fallback' : 'open-meteo',
      forecast
    });
  } catch (err) {
    console.error('[forecast]', err);
    return fail(res, err.status || 500, err.status ? err.message : 'Could not generate the forecast. Try again shortly.');
  }
};
